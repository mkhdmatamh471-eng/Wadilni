const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'dental_cloud_db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ patients: [] }, null, 2));

// متغيرات الحالة
let pairingCode = ""; 
let isConnecting = false;
let connectionStatus = "DISCONNECTED";
let targetPhone = ""; // سيتم ملؤه من الواجهة

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--no-zygote',
            '--single-process', '--disable-gpu',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ] 
    }
});

client.on('ready', () => {
    connectionStatus = "CONNECTED";
    pairingCode = "";
    console.log('🚀 متصل بنجاح!');
});

client.on('disconnected', () => {
    connectionStatus = "DISCONNECTED";
    pairingCode = "";
    targetPhone = "";
    client.initialize();
});

client.initialize();

// --- واجهة الربط ---

app.get('/auth', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    // 1. إذا كان متصلاً بالفعل
    if (connectionStatus === "CONNECTED") {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                <h1 style="color:#10b981;">✅ النظام متصل الآن</h1>
                <button onclick="window.location.href='/'" style="padding:10px 20px; border:none; background:#3b82f6; color:white; border-radius:10px; cursor:pointer;">العودة للرئيسية</button>
            </div>
        `);
    }

    // 2. إذا تم طلب الكود وهو جاهز الآن
    if (pairingCode) {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h2>كود الربط للرقم: ${targetPhone}</h2>
                <div style="background:#fff; display:inline-block; padding:30px 50px; border:5px solid #3b82f6; border-radius:20px; font-size:50px; font-weight:bold; letter-spacing:10px; color:#1e40af; margin:20px 0;">
                    ${pairingCode}
                </div>
                <p>أدخل الكود في واتساب هاتفك الآن.</p>
                <button onclick="window.location.reload()" style="background:none; border:none; color:#3b82f6; text-decoration:underline; cursor:pointer;">تحديث الصفحة</button>
            </div>
        `);
    }

    // 3. إذا كان جاري طلب الكود
    if (isConnecting) {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                <div style="border:5px solid #f3f3f3; border-top:5px solid #3b82f6; border-radius:50%; width:50px; height:50px; animation:spin 1s linear infinite; margin:auto;"></div>
                <p>جاري طلب الكود للرقم ${targetPhone}... يرجى الانتظار</p>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                <script>setTimeout(() => window.location.reload(), 3000);</script>
            </div>
        `);
    }

    // 4. الواجهة الافتراضية: إدخال الرقم
    res.send(`
        <div style="text-align:center; font-family:sans-serif; margin-top:50px; padding:20px;">
            <h2 style="color:#1e293b;">ربط واتساب العيادة</h2>
            <p style="color:#64748b;">أدخل رقم الهاتف مع رمز الدولة (مثال: 967785022014)</p>
            
            <form action="/request-code" method="POST" style="margin-top:30px;">
                <input type="text" name="phone" placeholder="967XXXXXXXXX" required 
                    style="padding:15px; width:280px; border:2px solid #e2e8f0; border-radius:15px; font-size:18px; text-align:center; outline:none; focus:border-blue-500;">
                <br><br>
                <button type="submit" 
                    style="padding:15px 40px; background:#3b82f6; color:white; border:none; border-radius:15px; font-weight:bold; cursor:pointer; font-size:16px;">
                    طلب كود الربط
                </button>
            </form>
        </div>
    `);
});

// استقبال طلب الكود من الواجهة
app.use(express.urlencoded({ extended: true })); // لقراءة بيانات الفورم

app.post('/request-code', async (req, res) => {
    const phone = req.body.phone.replace(/\D/g, ''); // تنظيف الرقم
    
    if (!phone || phone.length < 10) {
        return res.send("رقم الهاتف غير صحيح. <a href='/auth'>عودة</a>");
    }

    targetPhone = phone;
    isConnecting = true;
    pairingCode = "";

    console.log(`⏳ جاري طلب كود للرقم: ${targetPhone}`);
    
    try {
        // ننتظر قليلاً للتأكد من جاهزية المحرك
        await new Promise(resolve => setTimeout(resolve, 3000));
        pairingCode = await client.requestPairingCode(targetPhone);
        console.log(`✅ الكود المولّد: ${pairingCode}`);
    } catch (err) {
        console.error("❌ فشل طلب الكود:", err.message);
    } finally {
        isConnecting = false;
        res.redirect('/auth'); // العودة لصفحة العرض
    }
});

// بقية الـ Endpoints (sync, upload, send-reminder) تظل كما هي...
app.post('/api/send-reminder', async (req, res) => {
    const { phone, message } = req.body;
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('7')) cleanPhone = '967' + cleanPhone;
        const chatId = cleanPhone + "@c.us";
        await client.sendMessage(chatId, message);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
