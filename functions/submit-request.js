import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const data = await request.json();
        const { codigo, levelID, ownership, parts, permission, difficulty, video, tags, rated, stars, preview, comments, feedback } = data;

        const serviceAccountAuth = new JWT({
            email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: env.GOOGLE_PRIVATE_KEY.replace(/\\\\n/g, '\\n'),
            scopes: ['<https://www.googleapis.com/auth/spreadsheets>'],
        });

        const doc = new GoogleSpreadsheet(env.GOOGLE_SHEET_ID, serviceAccountAuth);

        await doc.loadInfo();
        const sheetNiveles = doc.sheetsByIndex[0];
        const sheetUsuarios = doc.sheetsByIndex[1];

        const usuariosRows = await sheetUsuarios.getRows();
        const validUser = usuariosRows.find(row => row.get('codigo') === codigo);

        if (!validUser) {
            return new Response(JSON.stringify({ error: "Invalid access code." }), {
                status: 403,
                headers: { "Content-Type": "application/json" }
            });
        }

        const nombreReal = validUser.get('nombre');
        const nivelesRows = await sheetNiveles.getRows();
        const now = new Date();

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const friendlyDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        const reversedRows = [...nivelesRows].reverse();
        const userRow = reversedRows.find(row => row.get('codigo') === codigo);

        if (userRow) {
            const lastDateStr = userRow.get('fecha');

            if (lastDateStr) {
                const parsedDateStr = lastDateStr.includes('T') ? lastDateStr : lastDateStr.replace(' ', 'T');
                const lastDate = new Date(parsedDateStr);

                if (!isNaN(lastDate)) {
                    const diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
                    if (diffDays < 7) {
                        const faltan = Math.ceil(7 - diffDays);
                        return new Response(JSON.stringify({ error: `Hi ${nombreReal}, you must wait ${faltan} more days to send another level.` }), {
                            status: 403,
                            headers: { "Content-Type": "application/json" }
                        });
                    }
                }
            }
        }

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

        return new Response(JSON.stringify({ message: `Success, ${nombreReal}! Level submitted.` }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}