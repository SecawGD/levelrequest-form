// Función auxiliar para firmar la petición a Google
async function getGoogleAuthToken(env) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        scope: 'https://www.googleapis.com/auth/spreadsheets', 
        aud: 'https://oauth2.googleapis.com/token',            
        exp: now + 3600,
        iat: now
    };

    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const encodedClaim = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signatureInput = `${encodedHeader}.${encodedClaim}`;

    let privateKey = env.GOOGLE_PRIVATE_KEY;
    if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');

    const pemContents = privateKey.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
        "pkcs8",
        binaryDer.buffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signatureInput));

    let binarySignature = '';
    const bytes = new Uint8Array(signature);
    for (let i = 0; i < bytes.byteLength; i++) binarySignature += String.fromCharCode(bytes[i]);

    const encodedSignature = btoa(binarySignature).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const jwt = `${signatureInput}.${encodedSignature}`;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
}

// Función para generar un Access Code de 6 caracteres
function generateAccessCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const data = await request.json();
        const { username, token } = data;

        if (!username || !token) {
            return new Response(JSON.stringify({ error: "Faltan datos de usuario o token." }), { status: 400 });
        }

        // 1. Verificación con GDBrowser
        const gdResponse = await fetch(`https://gdbrowser.com/api/profile/${username}`);
        if (!gdResponse.ok) {
            return new Response(JSON.stringify({ error: "El usuario no existe en Geometry Dash." }), { status: 404 });
        }

        const gdProfile = await gdResponse.json();
        const userCustomField = gdProfile.customURL || gdProfile.custom || ""; 

        // Si el token no es igual, rechazamos
        if (userCustomField !== token) {
            return new Response(JSON.stringify({ 
                error: "El token no coincide. Dale a 'Update' en GD y espera un par de minutos a que GDBrowser se actualice." 
            }), { status: 403 });
        }

        // 2. Conexión con Google Sheets
        const tokenSheets = await getGoogleAuthToken(env);
        const sheetId = env.GOOGLE_SHEET_ID;

        // Obtenemos el nombre de la hoja de usuarios (asumimos que es la segunda hoja, index 1)
        const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
            headers: { Authorization: `Bearer ${tokenSheets}` }
        });
        const meta = await metaRes.json();
        const sheetUsuariosName = meta.sheets[1].properties.title;

        // Obtenemos los usuarios actuales
        const usersRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetUsuariosName}`, {
            headers: { Authorization: `Bearer ${tokenSheets}` }
        });
        const usersData = await usersRes.json();
        const usersRows = usersData.values || [];
        
        const headers = usersRows[0] || ['codigo', 'nombre'];
        const codigoIdx = headers.indexOf('codigo');
        const nombreIdx = headers.indexOf('nombre');

        let accessCode = "";
        let isNewUser = true;

        // Buscamos si el usuario ya existe (ignorando mayúsculas/minúsculas)
        const existingUser = usersRows.slice(1).find(row => row[nombreIdx].toLowerCase() === username.toLowerCase());

        if (existingUser) {
            // Si ya existe, le devolvemos su código de siempre
            accessCode = existingUser[codigoIdx];
            isNewUser = false;
        } else {
            // Si es nuevo, creamos un código y lo guardamos
            accessCode = generateAccessCode();
            
            const newRow = [];
            newRow[codigoIdx !== -1 ? codigoIdx : 0] = accessCode;
            newRow[nombreIdx !== -1 ? nombreIdx : 1] = username;

            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetUsuariosName}:append?valueInputOption=USER_ENTERED`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${tokenSheets}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ values: [newRow] })
            });
        }

        return new Response(JSON.stringify({ 
            message: isNewUser ? "Account successfully linked!" : "Welcome back! Account verified.",
            accessCode: accessCode 
        }), { status: 200, headers: { "Content-Type": "application/json" } });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}