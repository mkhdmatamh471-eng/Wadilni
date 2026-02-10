import asyncio
import threading
import sys
import os
import logging
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pyrogram import Client
from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode
import google.generativeai as genai
from datetime import datetime

# --- إعداد السجلات ---
logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("pyrogram").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# --- استيراد الإعدادات ---
try:
    from config import normalize_text, CITIES_DISTRICTS, BOT_TOKEN
    print("✅ تم تحميل الإعدادات بنجاح")
except Exception as e:
    print(f"❌ خطأ في تحميل ملف config.py: {e}")
    sys.exit(1)

# --- متغيرات البيئة ---
API_ID = os.environ.get("API_ID", "33888256")
API_HASH = os.environ.get("API_HASH", "bb1902689a7e203a7aedadb806c08854")
SESSION_STRING = os.environ.get("SESSION_STRING", "BAIFGAAAWH0qADVIqGjuDmtifoW-SQxSznz5ZhQjTbbPT2_wrX7IXCv95zqwku9kG4rpIf_xv3IDkt7CFUETnMEtUIff39Po9PwGgsiivLE1Mrbs6Ymw-h7qQap0oxSpSuIVRzWQT8_DWRJ8NGcTtp8VOJrZ7tjvjDMuVouYYd5ZmGNKry7QCQSRZuNCxc29IUC_eirR4KJKwC5IV1Ve5_Jq3PYYr8nsmiEvYauzrwftmivipkmg9CDyQfVxBfJmKi9WJuWQVvTqJWeIYYkBFLJmkcjOAKsej9fqzD4laRJIsKXaVxgfwmX5STeBpjBI7EPlMn9v0UvKQT49rYNQer0UyRSUWAAAAAH9nH9OAA")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyDtF2lEZuEvI1hTFFrPRbGwwvj7ZocdPjs")

# ---------------------------------------------------------
# 🛠️ [تعديل 1] قائمة المستخدمين الذين سيستلمون الطلبات
# ضع الـ IDs الخاصة بهم هنا (أرقام فقط)
# ---------------------------------------------------------
# 🛠️ قائمة الـ IDs المحدثة الذين سيستلمون الطلبات في الخاص (مفتوحة)
CHANNEL_ID = -1003843717541 
 # <--- ضع الآيديات الحقيقية هنا

TARGET_USERS = [
    7996171713, 7513630480, 669659550, 6813059801, 632620058, 7093887960, 8024679997
]




# --- إعداد Gemini 1.5 Flash ---
genai.configure(api_key=GEMINI_API_KEY)
generation_config = {
  "temperature": 0.1,
  "top_p": 0.95,
  "top_k": 40,
  "max_output_tokens": 5,
}
ai_model = genai.GenerativeModel(
  model_name="gemini-1.5-flash",
  generation_config=generation_config,
)

# --- عملاء تليجرام ---
user_app = Client("my_session", session_string=SESSION_STRING, api_id=API_ID, api_hash=API_HASH)
bot_sender = Bot(token=BOT_TOKEN)

# ---------------------------------------------------------
# قوائم الفلترة (كما هي في كودك الأصلي)
# ---------------------------------------------------------
# قائمة 1: كلمات تدل أن المرسل سائق أو إعلان أو مواضيع محظورة (حظر فوري)
BLOCK_KEYWORDS = [
    "متواجد", "متاح", "شغال", "جاهز", "أسعارنا", "سيارة نظيفة", "نقل عفش", 
    "دربك سمح", "توصيل مشاوير", "أوصل", "اوصل", "اتصال", "واتساب", "للتواصل",
    "خاص", "الخاص", "بخدمتكم", "خدمتكم", "أستقبل", "استقبل", "نقل بضائع",
    "مشاويركم", "سياره نظيفه", "فان", "دباب", "سطحه", "سطحة", "كابتن", 
    "مندوب", "مناديب", "توصيل طلبات", "ارخص الأسعار", "أرخص الأسعار", "بأسعار",
    "عقار", "عقارات", "للبيع", "للإيجار", "للايجار", "دور", "شقة", "شقه",
    "رخصة فال", "رخصة", "رخصه", "مخطط", "أرض", "ارض", "فلة", "فله", 
    "عماره", "عمارة", "استثمار", "صك", "إفراغ", "الوساطة العقارية", "تجاري", "سكني",
    "اشتراك", "باقات", "تسجيل", "تأمين", "تفويض", "تجديد", "قرض", "تمويل", 
    "بنك", "تسديد", "مخالفات", "اعلان", "إعلان", "قروب", "مجموعة", "انضم", 
    "رابط", "نشر", "قوانين", "احترام", "الذوق العام", "استقدام", "خادمات",
    "تعقيب", "معقب", "انجاز", "إنجاز", "كفيل", "نقل كفالة", "اسقاط", "تعديل مهنة",
    "حياك الله", "نورتنا", "انضمامك", "أهلاً بك", "اهلا بك", "قواعد المجموعة",
    "مرحباً بك", "مرحبا بك", "تنبيه", "محظور", "يُمنع", "يمنع", "بالتوفيق للجميع",
    "http", "t.me", ".com", "رابط القناة", "اخلاء مسؤولية", "ذمة",
    # الكلمات الجديدة المضافة:
    "استثمار", "زواج", "مسيار", "خطابه", "خطابة"
]

# قائمة 2: كلمات خارج السياق (طبي، أعذار، استفسارات عامة) - حظر فوري
IRRELEVANT_TOPICS = [
    "عيادة", "عياده", "اسنان", "أسنان", "دكتور", "طبيب", "مستشفى", "مستوصف",
    "علاج", "تركيب", "تقويم", "خلع", "حشو", "تنظيف", "استفسار", "افضل", "أفضل",
    "تجربة", "مين جرب", "رأيكم", "تنصحون", "ورشة", "سمكري", "قطع غيار",
    # الكلمات الجديدة المضافة:
    "عذر طبي", "سكليف", "سكليفات"
]


# ---------------------------------------------------------
# 2. المحرك الهجين (Hybrid Engine)
# ---------------------------------------------------------
async def analyze_message_hybrid(text):
    if not text or len(text) < 5 or len(text) > 400: return False

    clean_text = normalize_text(text)
    # تحديث نمط المسارات ليشمل معالم جدة الشهيرة (المطار، الكورنيش، الميناء)
    route_pattern = r"(^|\s)من\s+.*?\s+(إلى|الى|لـ|للمطار|للكورنيش|للواجهة|للميناء)(\s|$)"
    if re.search(route_pattern, clean_text):
        return True 

    if any(k in clean_text for k in BLOCK_KEYWORDS): return False
    if any(k in clean_text for k in IRRELEVANT_TOPICS): return False

    # البرومبت الشامل المحدث لمدينة جدة
    prompt = f"""
    Role: You are an elite AI Traffic Controller for a 'Jeddah Taxi & Delivery' Telegram group.
    Objective: Filter messages to identify REAL CUSTOMERS seeking services in Jeddah.
    
    [STRICT ANALYSIS RULES]
    Identify if the SENDER is a CUSTOMER needing a ride or delivery in Jeddah.

    [✅ CLASSIFY AS 'YES' (JEDDAH CUSTOMER REQUESTS)]
    1. Explicit Ride Requests: (e.g., "أبغى سواق بجدة", "مطلوب كابتن", "سيارة للمطار", "مين يوديني الكورنيش؟").
    2. Route Descriptions: Mentioning Jeddah areas (e.g., "من السامر للتحلية", "مشوار من أبحر للبلد", "إلى رد سي مول").
    3. Location Pings: (e.g., "أحد حول حي المنار؟", "في كباتن في الحمدانية؟", "حي السلامة؟").
    4. Delivery: (e.g., "توصيل غرض من المطار", "مندوب لحي الصفا").

    [❌ CLASSIFY AS 'NO']
    Ignore Driver offers ("شغال الآن", "سيارة نظيفة") or Spams.

    [📍 JEDDAH CONTEXT KNOWLEDGE]
    Valid Jeddah locations: 
    (Al-Safa, Al-Samer, Al-Hamdania, Obhur, Al-Rawdah, Al-Salama, Al-Zahra, Al-Balad, Al-Baghdadia, Al-Rehab, Al-Marwah, Red Sea Mall, Jeddah Park, Airport T1).

    Input Text: "{text}"

    FINAL ANSWER (Reply ONLY with 'YES' or 'NO'):
    """

    try:
        response = await asyncio.to_thread(ai_model.generate_content, prompt)
        result = response.text.strip().upper().replace(".", "")
        return "YES" in result
    except Exception as e:
        print(f"⚠️ تجاوز AI: {e}")
        return manual_fallback_check(clean_text)


def manual_fallback_check(clean_text):
    order_words = ["ابي", "ابغي", "محتاج", "نبي", "مطلوب", "بكم"]
    service_words = ["سواق", "توصيل", "مشوار", "يوديني", "يوصلني"]
    has_order = any(w in clean_text for w in order_words)
    has_service = any(w in clean_text for w in service_words)
    has_route = "من " in clean_text and ("الى" in clean_text or "لي" in clean_text)
    return (has_order and has_service) or has_route

# ---------------------------------------------------------
# 3. [تعديل 2] دالة الإرسال للمستخدمين المحددين
# ---------------------------------------------------------
async def notify_users(detected_district, original_msg):
    content = original_msg.text or original_msg.caption
    if not content: return

    try:
        customer = original_msg.from_user

        # 1. رابط حساب العميل المباشر
        # إذا كان لدى العميل "username" نستخدمه، وإلا نستخدم "id" (رابط دائم)
        if customer and customer.username:
            direct_contact_url = f"https://t.me/{customer.username}"
        elif customer:
            direct_contact_url = f"tg://user?id={customer.id}"
        else:
            direct_contact_url = None # لا يمكن المراسلة إذا كان مخفياً

        # 2. رابط مصدر الرسالة في الجروب
        # ملاحظة: الروابط المباشرة للجروبات الخاصة تتطلب أن يكون المستخدم منضماً للجروب
        
        # 3. تجهيز الأزرار
                # اسم يوزر البوت الخاص بك (بدون @)
        bot_username = "Mishweribot" 
        
        # إنشاء رابط وسيط يحتوي على آيدي العميل
        gateway_url = f"https://t.me/{bot_username}?start=direct_{customer.id}"

        buttons_list = [
            [InlineKeyboardButton("💬 مراسلة العميل (عبر البوت)", url=gateway_url)],
        ]

        # زر المصدر
       

        keyboard = InlineKeyboardMarkup(buttons_list)

        alert_text = (
            f"🎯 <b>طلب جديد تم التقاطه!</b>\n\n"
            f"📍 <b>المنطقة:</b> {detected_district}\n"
            f"👤 <b>اسم العميل:</b> {customer.first_name if customer else 'مخفي'}\n"
            f"📝 <b>نص الطلب:</b>\n<i>{content}</i>\n\n"
            f"⏰ <b>الوقت:</b> {datetime.now().strftime('%H:%M:%S')}"
        )

        # 4. التكرار لإرسال الرسالة لكل شخص في القائمة TARGET_USERS
        for user_id in TARGET_USERS:
            try:
                await bot_sender.send_message(
                    chat_id=user_id,
                    text=alert_text,
                    reply_markup=keyboard,
                    parse_mode=ParseMode.HTML
                )
            except Exception as e_user:
                print(f"⚠️ فشل الإرسال للمستخدم {user_id}: {e_user}")

        print(f"✅ تم توزيع الطلب ({detected_district}) للمشتركين.")

    except Exception as e:
        print(f"❌ خطأ عام في دالة الإرسال: {e}")

async def notify_channel(detected_district, original_msg):
    content = original_msg.text or original_msg.caption
    if not content: return

    try:
        customer = original_msg.from_user
        customer_id = customer.id if customer else 0
        
        # --- الإعدادات ---
        bot_username = "Mishweribot" 

        # ✅ توحيد الرابط ليستخدم "chat_" ليتوافق مع معالج start_command
        gate_contact = f"https://t.me/{bot_username}?start=chat_{customer_id}"

        buttons = [
            # هذا الزر الآن يوجه لنفس المعالج الذي يفحص الاشتراك
            [InlineKeyboardButton("💬 مراسلة العميل (للمشتركين)", url=gate_contact)],
            [InlineKeyboardButton("💳 للاشتراك وتفعيل الحساب", url="https://t.me/servecest")]
        ]

        keyboard = InlineKeyboardMarkup(buttons)

        alert_text = (
            f"🎯 <b>طلب مشوار جديد</b>\n\n"
            f"📍 <b>المنطقة:</b> {detected_district}\n"
            f"📝 <b>التفاصيل:</b>\n<i>{content}</i>\n\n"
            f"⏰ <b>الوقت:</b> {datetime.now().strftime('%H:%M:%S')}\n\n"
            f"⚠️ <i>الزر أعلاه يفتح للمشتركين فقط.</i>"
        )

        await bot_sender.send_message(
            chat_id=CHANNEL_ID,
            text=alert_text,
            reply_markup=keyboard,
            parse_mode=ParseMode.HTML
        )
        print(f"✅ تم الإرسال للقناة برابط موحد (chat_): {detected_district}")

    except Exception as e:
        print(f"❌ خطأ إرسال للقناة: {e}")

# ---------------------------------------------------------
# 4. الرادار الرئيسي
# ---------------------------------------------------------
async def start_radar():
    await user_app.start()
    print("🚀 الرادار يعمل ويرسل للمستخدمين المحددين...")

    # [هام] قم بإرسال رسالة تجريبية لنفسك عند التشغيل للتأكد
    # يمكنك إزالة هذا السطر لاحقاً
    if TARGET_USERS:
        try:
            await bot_sender.send_message(TARGET_USERS[0], "✅ تم تشغيل البوت بنجاح")
        except: pass

    last_processed = {}

    while True:
        try:
            await asyncio.sleep(5) 

            async for dialog in user_app.get_dialogs(limit=50):
                # تأكد من أن الحوار هو "مجموعة" أو "سوبر جروب"
                dialog_type = str(dialog.chat.type).upper()
                if "GROUP" not in dialog_type and "SUPERGROUP" not in dialog_type: 
                    continue

                chat_id = dialog.chat.id

                # جلب آخر رسالة
                try:
                    async for msg in user_app.get_chat_history(chat_id, limit=1):
                        # تخطي الرسائل القديمة أو المعالجة مسبقاً
                        if chat_id in last_processed and msg.id <= last_processed[chat_id]:
                            continue

                        last_processed[chat_id] = msg.id

                        text = msg.text or msg.caption
                        # تجاهل رسائل البوت نفسه أو الرسائل الفارغة
                        if not text or (msg.from_user and msg.from_user.is_self): continue

                        # التحليل
                        is_valid_order = await analyze_message_hybrid(text)

                        if is_valid_order:
                            # استخراج الحي (اختياري)
                            found_d = "عام"
                            text_c = normalize_text(text)
                            for city, districts in CITIES_DISTRICTS.items():
                                for d in districts:
                                    if normalize_text(d) in text_c:
                                        found_d = d
                                        break

                            # [تعديل 3] استدعاء دالة الإرسال للمستخدمين
                            
             # ✅ [التعديل المطلوب] استدعاء الدالتين معاً
                            await notify_users(found_d, msg)   # الإرسال للأشخاص في الخاص
                            await notify_channel(found_d, msg) # الإرسال للقناة العامة
                except Exception as e_chat:
                    # أحياناً يحدث خطأ في قراءة مجموعة معينة، نتجاوزها
                    continue

        except Exception as e:
            print(f"⚠️ خطأ في الدورة الرئيسية: {e}")
            await asyncio.sleep(5)

# --- خادم الويب (Health Check) ---
class HealthCheckHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Bot is Sending to Users Direct Message")
    def log_message(self, format, *args): return

def run_health_server():
    port = int(os.environ.get("PORT", 10000))
    httpd = HTTPServer(('0.0.0.0', port), HealthCheckHandler)
    httpd.serve_forever()

if __name__ == "__main__":
    threading.Thread(target=run_health_server, daemon=True).start()
    asyncio.run(start_radar())