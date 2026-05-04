const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    // Extraemos todos los datos nuevos del formulario
    const data = JSON.parse(event.body);
    const { codigo, levelID, ownership, parts, permission, difficulty, video, tags, rated, stars, preview, comments, feedback } = data;
    
    const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
    
    try {
        await doc.loadInfo();
        const sheetNiveles = doc.sheetsByIndex[0];
        const sheetUsuarios = doc.sheetsByIndex[1];

        // 1. VERIFICACIÓN DE IDENTIDAD
        const usuariosRows = await sheetUsuarios.getRows();
        const validUser = usuariosRows.find(row => row.get('codigo') === codigo);

        if (!validUser) {
            return { statusCode: 403, body: JSON.stringify({ error: "Invalid access code." }) };
        }

        const nombreReal = validUser.get('nombre');

        // 2. LÓGICA DE 7 DÍAS
        const nivelesRows = await sheetNiveles.getRows();
        const now = new Date();
        const userRow = nivelesRows.reverse().find(row => row.get('codigo') === codigo);

        if (userRow) {
            const lastDate = new Date(userRow.get('fecha'));
            const diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
            if (diffDays < 7) {
                const faltan = Math.ceil(7 - diffDays);
                return { statusCode: 403, body: JSON.stringify({ error: `Hi ${nombreReal}, you must wait ${faltan} more days to send another level.` }) };
            }
        }

        // 3. GUARDAR TODOS LOS DATOS
        await sheetNiveles.addRow({
            fecha: now.toISOString(),
            codigo: codigo,
            levelID: levelID,
            ownership: ownership || '',
            parts: parts || '',
            permission: permission || '',
            difficulty: difficulty || '',
            video: video || '',
            tags: tags || '',
            rated: rated || '',
            stars: stars || '',
            preview: preview || '',
            comments: comments || '',
            feedback: feedback || ''
        });

        return { statusCode: 200, body: JSON.stringify({ message: `Success, ${nombreReal}! Level submitted.` }) };
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
