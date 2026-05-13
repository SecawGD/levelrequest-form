export async function onRequestPost(context) {
    const { request } = context;

    try {
        const data = await request.json();
        const username = data.username;
        const tokenGenerado = data.token; // El token que le dio tu web (ej: SEC-948A2)

        if (!username || !tokenGenerado) {
            return new Response(JSON.stringify({ error: "Missing username or token." }), { 
                status: 400, headers: { "Content-Type": "application/json" } 
            });
        }

        // --- PASO 1: Buscar el AccountID del jugador ---
        // RobTop requiere el AccountID para ver perfiles, así que primero lo buscamos por su nombre
        const searchParams = new URLSearchParams();
        searchParams.append('str', username);
        searchParams.append('secret', 'Wmfd2893gb7'); // La contraseña interna oficial de GD

        const searchRes = await fetch('http://www.boomlings.com/database/getGJUsers20.php', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': '' // Boomlings a veces bloquea bots, esto lo evita
            },
            body: searchParams.toString()
        });
        const searchText = await searchRes.text();

        // Si devuelve "-1", el jugador no existe
        if (searchText === '-1' || searchText.startsWith('<')) {
            return new Response(JSON.stringify({ error: "Player not found in Geometry Dash servers." }), { 
                status: 404, headers: { "Content-Type": "application/json" } 
            });
        }

        // Extraemos el AccountID (En GD los datos vienen separados por ":")
        const searchParts = searchText.split(':');
        const accountIdIndex = searchParts.indexOf('16') + 1; // La clave '16' siempre es el AccountID
        const accountID = searchParts[accountIdIndex];

        // --- PASO 2: Leer el perfil para ver el campo "Custom" ---
        const profileParams = new URLSearchParams();
        profileParams.append('targetAccountID', accountID);
        profileParams.append('secret', 'Wmfd2893gb7');

        const profileRes = await fetch('http://www.boomlings.com/database/getGJUserInfo20.php', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': '' 
            },
            body: profileParams.toString()
        });
        const profileText = await profileRes.text();

        if (profileText === '-1' || profileText.startsWith('<')) {
            return new Response(JSON.stringify({ error: "Could not load player profile." }), { 
                status: 500, headers: { "Content-Type": "application/json" } 
            });
        }

        // --- PASO 3: El Veredicto (Buscar el Token) ---
        // Desarmamos el texto gigante del perfil
        const profileParts = profileText.split(':');
        
        // Verificamos si en alguna parte de su perfil está escrito EXACTAMENTE el token que le dimos
        if (profileParts.includes(tokenGenerado)) {
            // ¡Match! El usuario es real.
            // Más adelante, aquí irá el código que lo inscribe en Google Sheets.
            return new Response(JSON.stringify({ 
                success: true, 
                message: `✅ ¡Verificación exitosa! Tu cuenta '${username}' es legítima.` 
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        } else {
            // No hubo coincidencia
            return new Response(JSON.stringify({ 
                success: false, 
                error: "❌ El código no coincide o aún no se ha guardado en el juego. Ponlo en el campo 'Custom' y dale a Update." 
            }), { status: 401, headers: { "Content-Type": "application/json" } });
        }

    } catch (err) {
        return new Response(JSON.stringify({ error: "Server error: " + err.message }), { 
            status: 500, headers: { "Content-Type": "application/json" } 
        });
    }
}