const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { codigo } = JSON.parse(event.body);
    
    if (!codigo) {
        return { statusCode: 400, body: JSON.stringify({ error: "Access code is required." }) };
    }

    const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
    
    try {
        await doc.loadInfo();
        const sheetNiveles = doc.sheetsByIndex[0];
        const nivelesRows = await sheetNiveles.getRows();

        const userRow = nivelesRows.reverse().find(row => row.get('codigo') === codigo);

        if (!userRow) {
            return { statusCode: 404, body: JSON.stringify({ error: "No level request found for this access code." }) };
        }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                levelID: userRow.get('levelID'),
                estado: userRow.get('estado') || 'Pendiente',
                fecha: userRow.get('fecha')
            }) 
        };
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};