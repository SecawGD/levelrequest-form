// Función auxiliar para firmar la petición a Google sin usar librerías externas
async function getGoogleAuthToken(env) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        scope: '<https://www.googleapis.com/auth/spreadsheets>',
        aud: '<https://oauth2.googleapis.com/token>',
        exp: now + 3600,
        iat: now
    };

    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
    const encodedClaim = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
    const signatureInput = `${encodedHeader}.${encodedClaim}`;

    let privateKey = env.GOOGLE_PRIVATE_KEY;
    if (privateKey.includes('\\\\n')) privateKey = privateKey.replace(/\\\\n/g, '\\n');

    const pemContents = privateKey.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\\s/g, "");
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

    const encodedSignature = btoa(binarySignature).replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
    const jwt = `${signatureInput}.${encodedSignature}`;

    const tokenResponse = await fetch('<https://oauth2.googleapis.com/token>', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const data = await request.json();
        const token = await getGoogleAuthToken(env);
        const sheetId = env.GOOGLE_SHEET_ID;

        // 1. Obtener nombres de las hojas
        const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const meta = await metaRes.json();
        if (meta.error) throw new Error(meta.error.message);

        const sheetNivelesName = meta.sheets[0].properties.title;
        const sheetUsuariosName = meta.sheets[1].properties.title;

        // 2. Verificación de Identidad
        const usersRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetUsuariosName}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const usersData = await usersRes.json();
        const usersRows = usersData.values || [];

        if (usersRows.length < 2) return new Response(JSON.stringify({ error: "No users found in database." }), { status: 403 });

        const usersHeaders = usersRows[0];
        const codigoIdx = usersHeaders.indexOf('codigo');
        const nombreIdx = usersHeaders.indexOf('nombre');

        const validUserRow = usersRows.slice(1).find(row => row[codigoIdx] === data.codigo);
        if (!validUserRow) return new Response(JSON.stringify({ error: "Invalid access code." }), { status: 403 });
        const nombreReal = validUserRow[nombreIdx];

        // 3. Lógica de 7 días
        const nivelesRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetNivelesName}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const nivelesData = await nivelesRes.json();
        const nivelesRows = nivelesData.values || [];
        const nivelesHeaders = nivelesRows[0] || [];

        const nCodigoIdx = nivelesHeaders.indexOf('codigo');
        const nFechaIdx = nivelesHeaders.indexOf('fecha');

        const now = new Date();
        const friendlyDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const pastLevels = nivelesRows.slice(1).reverse();
        const lastUserLevel = pastLevels.find(row => row[nCodigoIdx] === data.codigo);

        if (lastUserLevel) {
            const lastDateStr = lastUserLevel[nFechaIdx];
            if (lastDateStr) {
                const parsedDateStr = lastDateStr.includes('T') ? lastDateStr : lastDateStr.replace(' ', 'T');
                const lastDate = new Date(parsedDateStr);
                if (!isNaN(lastDate)) {
                    const diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
                    if (diffDays < 7) {
                        const faltan = Math.ceil(7 - diffDays);
                        return new Response(JSON.stringify({ error: `Hi ${nombreReal}, you must wait ${faltan} more days to send another level.` }), { status: 403, headers: { "Content-Type": "application/json" } });
                    }
                }
            }
        }

        // 4. Guardar todos los datos
        const newRowObj = {
            estado: 'Pendiente', fecha: friendlyDate, codigo: data.codigo,
            levelID: data.levelID, ownership: data.ownership || '', parts: data.parts || '',
            permission: data.permission || '', difficulty: data.difficulty || '', video: data.video || '',
            tags: data.tags || '', rated: data.rated || '', stars: data.stars || '',
            preview: data.preview || '', comments: data.comments || '', feedback: data.feedback || ''
        };

        const rowArrayToInsert = nivelesHeaders.map(header => newRowObj[header] !== undefined ? newRowObj[header] : '');

        const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetNivelesName}:append?valueInputOption=USER_ENTERED`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [rowArrayToInsert] })
        });

        if (!appendRes.ok) {
            const errData = await appendRes.json();
            throw new Error("Google Sheets Error: " + JSON.stringify(errData));
        }

        return new Response(JSON.stringify({ message: `Success, ${nombreReal}! Level submitted.` }), { status: 200, headers: { "Content-Type": "application/json" } });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}