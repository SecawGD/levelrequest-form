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
        
        // Creamos una fecha amigable (YYYY-MM-DD HH:mm:ss) para la base de datos
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const friendlyDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        const userRow = nivelesRows.reverse().find(row => row.get('codigo') === codigo);

        if (userRow) {
            // Obtenemos la última fecha registrada por este usuario
            const lastDateStr = userRow.get('fecha');
            
            if (lastDateStr) {
                // Reemplazamos el espacio por una 'T' para asegurar que Javascript pueda parsear
                // correctamente tanto las fechas viejas (ISO) como las nuevas (Friendly)
                const parsedDateStr = lastDateStr.includes('T') ? lastDateStr : lastDateStr.replace(' ', 'T');
                const lastDate = new Date(parsedDateStr);
                
                // Si la fecha es válida, procedemos a calcular la diferencia
                if (!isNaN(lastDate)) {
                    const diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
                    if (diffDays < 7) {
                        const faltan = Math.ceil(7 - diffDays);
                        return { statusCode: 403, body: JSON.stringify({ error: `Hi ${nombreReal}, you must wait ${faltan} more days to send another level.` }) };
                    }
                }
            }
        }

        // 3. GUARDAR TODOS LOS DATOS
        await sheetNiveles.addRow({
            estado: 'Pendiente',
            fecha: friendlyDate,
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