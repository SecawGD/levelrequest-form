const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { username, levelID } = JSON.parse(event.body);
    
    // Configurar la conexión con Google
    const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
    
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();

        // LÓGICA DE 7 DÍAS
        const now = new Date();
        const userRow = rows.reverse().find(row => row.get('usuario') === username);

        if (userRow) {
            const lastDate = new Date(userRow.get('fecha'));
            const diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
            
            if (diffDays < 7) {
                const faltan = Math.ceil(7 - diffDays);
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: `Debes esperar ${faltan} días más para enviar otra solicitud.` })
                };
            }
        }

        // Si pasó la validación, guardar datos
        await sheet.addRow({
            fecha: now.toISOString(),
            usuario: username,
            levelID: levelID
        });

        return { statusCode: 200, body: JSON.stringify({ message: "¡Éxito!" }) };
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
