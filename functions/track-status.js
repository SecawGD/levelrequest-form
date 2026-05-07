// ... existing code ...
import { GoogleSpreadsheet } from 'https://esm.sh/google-spreadsheet@4.1.1';
import { JWT } from 'https://esm.sh/google-auth-library@9.0.0';

export async function onRequestPost(context) {
// ... existing code ...

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const data = await request.json();
        const { codigo } = data;
        
        if (!codigo) {
            return new Response(JSON.stringify({ error: "Access code is required." }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        const serviceAccountAuth = new JWT({
            email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(env.GOOGLE_SHEET_ID, serviceAccountAuth);
        
        await doc.loadInfo();
        const sheetNiveles = doc.sheetsByIndex[0];
        const nivelesRows = await sheetNiveles.getRows();

        // BUG ARREGLADO: Evitamos mutar el array original
        const reversedRows = [...nivelesRows].reverse();
        const userRow = reversedRows.find(row => row.get('codigo') === codigo);

        if (!userRow) {
            return new Response(JSON.stringify({ error: "No level request found for this access code." }), {
                status: 404,
                headers: { "Content-Type": "application/json" }
            });
        }

        return new Response(JSON.stringify({ 
            levelID: userRow.get('levelID'),
            estado: userRow.get('estado') || 'Pendiente',
            fecha: userRow.get('fecha')
        }), {
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