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
        if (!data.codigo) return new Response(JSON.stringify({ error: "Access code is required." }), { status: 400, headers: { "Content-Type": "application/json" } });

        const token = await getGoogleAuthToken(env);
        const sheetId = env.GOOGLE_SHEET_ID;

        const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const meta = await metaRes.json();
        if (meta.error) throw new Error(meta.error.message);
        const sheetNivelesName = meta.sheets[0].properties.title;

        const nivelesRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetNivelesName}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const nivelesData = await nivelesRes.json();
        const nivelesRows = nivelesData.values || [];
        if (nivelesRows.length < 2) return new Response(JSON.stringify({ error: "No requests found." }), { status: 404, headers: { "Content-Type": "application/json" } });

        const headers = nivelesRows[0];
        const codigoIdx = headers.indexOf('codigo');
        const levelIDIdx = headers.indexOf('levelID');
        const estadoIdx = headers.indexOf('estado');
        const fechaIdx = headers.indexOf('fecha');

        const pastLevels = nivelesRows.slice(1).reverse();
        const userRow = pastLevels.find(row => row[codigoIdx] === data.codigo);

        if (!userRow) return new Response(JSON.stringify({ error: "No level request found for this access code." }), { status: 404, headers: { "Content-Type": "application/json" } });

        return new Response(JSON.stringify({
            levelID: userRow[levelIDIdx],
            estado: userRow[estadoIdx] || 'Pendiente',
            fecha: userRow[fechaIdx]
        }), { status: 200, headers: { "Content-Type": "application/json" } });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}