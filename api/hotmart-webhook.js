// /api/hotmart-webhook.js
//
// Esta funcion recibe el aviso automatico de Hotmart cuando alguien compra,
// y crea la cuenta del comprador en Firebase Authentication automaticamente.
// La persona despues entra a la app/curso, toca "Primera vez / olvide mi clave",
// pone su correo, y Firebase le manda un link para crear su clave (gratis, sin
// que nosotros tengamos que mandar ningun correo aparte).

const admin = require('firebase-admin');

// ---------- Inicializar Firebase Admin (una sola vez) ----------
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Eventos de Hotmart que consideramos "venta aprobada" (dan acceso)
const EVENTOS_QUE_DAN_ACCESO = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'];

module.exports = async (req, res) => {
  // Solo aceptamos POST (asi llega el aviso de Hotmart)
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const payload = req.body;

    // ---------- 1. Verificar que el aviso realmente viene de Hotmart ----------
    const hottokRecibido = payload.hottok || req.headers['x-hotmart-hottok'];
    if (!hottokRecibido || hottokRecibido !== process.env.HOTMART_HOTTOK) {
      console.warn('Webhook recibido con hottok invalido o ausente.');
      res.status(401).json({ error: 'Invalid hottok' });
      return;
    }

    // ---------- 2. Verificar que sea un evento de compra aprobada ----------
    const evento = payload.event;
    if (!EVENTOS_QUE_DAN_ACCESO.includes(evento)) {
      // No es un evento que nos interese (ej: carrito abandonado, reembolso, etc)
      // Respondemos 200 igual para que Hotmart no reintente sin necesidad.
      res.status(200).json({ ok: true, skipped: true, event: evento });
      return;
    }

    // ---------- 3. Sacar el correo del comprador ----------
    const email = payload?.data?.buyer?.email;
    const nombre = payload?.data?.buyer?.name || '';

    if (!email) {
      console.error('Webhook sin correo de comprador:', JSON.stringify(payload));
      res.status(400).json({ error: 'No buyer email in payload' });
      return;
    }

    // ---------- 4. Crear la cuenta en Firebase (si no existe ya) ----------
    let uid;
    try {
      const existente = await admin.auth().getUserByEmail(email);
      uid = existente.uid;
      console.log('La cuenta ya existia para:', email);
    } catch (err) {
      // Si no existe, la creamos con una clave temporal aleatoria.
      // La persona nunca usa esta clave: entra con "Primera vez / olvide mi clave"
      // y Firebase le manda un link para crear la suya propia.
      const claveTemporal = Math.random().toString(36).slice(-12) + 'Aa1!';
      const nuevoUsuario = await admin.auth().createUser({
        email,
        password: claveTemporal,
        displayName: nombre,
        emailVerified: true,
      });
      uid = nuevoUsuario.uid;
      console.log('Cuenta creada automaticamente para:', email);
    }

    res.status(200).json({ ok: true, uid, email });
  } catch (err) {
    console.error('Error procesando webhook de Hotmart:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};
