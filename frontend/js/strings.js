// Every user-facing string that is set from JavaScript, in Hebrew. Static page text lives in the .html files.
// Internal identifiers and data values (type keys, author_role, ...) stay in English; only their labels are here.

export const UNITS = { m: "מ׳", cm: "ס״מ", m2: "מ״ר", deg: "°" };

// Isolates a run of numbers (e.g. "5.00 × 4.00") so it keeps its left-to-right order inside Hebrew text.
export const ltr = (text) => `⁦${text}⁩`;

export const COMMON = {
  somethingWentWrong: "משהו השתבש. נסו שוב.",
  linkCopied: "הקישור הועתק",
  copyFailed: "ההעתקה נכשלה. סמנו את הקישור והעתיקו אותו ידנית.",
  open: "פתיחה",
  copyLink: "העתקת קישור",
};

// Shown for API failures, chosen by HTTP status. The server's own (English) text is never displayed.
export const API_ERRORS = {
  network: "אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.",
  401: "פג תוקף ההתחברות. התחברו שוב.",
  403: "אין לכם הרשאה לבצע פעולה זו.",
  404: "הפריט המבוקש לא נמצא.",
  409: "הפעולה לא התאפשרה: הגעתם למגבלה או שיש התנגשות עם נתונים קיימים.",
  413: "הקובץ או התוכנית גדולים מדי.",
  422: "הנתונים שהוזנו אינם תקינים. בדקו ונסו שוב.",
  generic: "אירעה תקלה בשרת. נסו שוב בעוד רגע.",
};

export const AUTH = {
  titles: { signin: "התחברות", signup: "יצירת חשבון", forgot: "איפוס סיסמה", reset: "בחירת סיסמה חדשה" },
  buttons: { signin: "התחברות", signup: "יצירת חשבון", forgot: "שליחת קישור לאיפוס", reset: "עדכון סיסמה" },
  studioTitle: "יצירת הסטודיו שלכם",
  draftSubtitle: "התחברו או צרו חשבון כדי לשמור את התוכנית.",
  backToSignin: "חזרה להתחברות",
  haveAccount: "כבר יש לי חשבון",
  createAccount: "הרשמה",
  newPassword: "סיסמה חדשה",
  password: "סיסמה",
  forgotNotice: "אם קיים חשבון עבור האימייל הזה, קישור לאיפוס סיסמה בדרך אליכם. בדקו את תיבת הדואר.",
  mismatch: "הסיסמאות אינן תואמות.",
  passwordUpdated: "הסיסמה עודכנה",
  confirmEmail: "שלחנו אליכם קישור לאישור במייל. אשרו אותו וחזרו להתחברות.",
  errors: {
    invalidLogin: "האימייל או הסיסמה שגויים.",
    alreadyRegistered: "כבר קיים חשבון עם האימייל הזה. נסו להתחבר.",
    rateLimit: "בוצעו יותר מדי ניסיונות. המתינו מעט ונסו שוב.",
    weakPassword: "הסיסמה חלשה או קצרה מדי. השתמשו ב-8 תווים לפחות.",
    emailNotConfirmed: "האימייל עדיין לא אושר. בדקו את תיבת הדואר שלכם.",
    samePassword: "הסיסמה החדשה חייבת להיות שונה מהקודמת.",
    invalidEmail: "כתובת האימייל אינה תקינה.",
    generic: "הפעולה לא הצליחה. נסו שוב.",
  },
};

export const ENTRY = {
  title: "התחילו לעצב",
  headline: (studio, clientName) => `${clientName ? `היי ${clientName}, ` : ""}תכננו את הבית שלכם עם ${studio}.`,
};

export const PROJECT_TYPES = { existing: "בית קיים", new_build: "בנייה חדשה" };

export const PROJECTS = { open: COMMON.open };

export const STUDIO = {
  accepted: "אושר",
  pending: "ממתין",
  copyLink: COMMON.copyLink,
  title: (name) => `${name} · סטודיו`,
};

export const ROLES = { designer: "מעצב", client: "לקוח" };

export const CATALOG = {
  groups: { Living: "סלון ופינת אוכל", Bedroom: "חדר שינה", Kitchen: "מטבח", Bathroom: "חדר רחצה" },
  furniture: {
    sofa: "ספה",
    armchair: "כורסה",
    "coffee-table": "שולחן סלון",
    "tv-unit": "מזנון טלוויזיה",
    "dining-table": "שולחן אוכל",
    chair: "כיסא",
    "double-bed": "מיטה זוגית",
    "single-bed": "מיטת יחיד",
    wardrobe: "ארון בגדים",
    desk: "שולחן כתיבה",
    "kitchen-counter": "משטח עבודה",
    "kitchen-island": "אי מטבח",
    sink: "כיור",
    stove: "כיריים",
    fridge: "מקרר",
    toilet: "אסלה",
    bathtub: "אמבטיה",
    shower: "מקלחון",
    vanity: "ארונית רחצה",
  },
};

export const ROOM_TYPE_LABELS = {
  living: "סלון",
  kitchen: "מטבח",
  bedroom: "חדר שינה",
  bathroom: "חדר רחצה",
  hallway: "מסדרון",
  balcony: "מרפסת",
  other: "אחר",
};
export const ROOM_TYPES = Object.entries(ROOM_TYPE_LABELS);

// Hebrew words that name a room in a drawing, first match wins (specific before general). `words` are compared
// without quotes and spaces, so ממ"ד, ממ״ד and ממד all match. `name` is what the room is called afterwards.
export const ROOM_WORDS = [
  { words: ["חדרשינה"], name: "חדר שינה", type: "bedroom" },
  { words: ["חדרהורים", "הורים"], name: "חדר הורים", type: "bedroom" },
  { words: ["חדרילדים", "ילדים"], name: "חדר ילדים", type: "bedroom" },
  { words: ["חדרעבודה", "משרד"], name: "חדר עבודה", type: "other" },
  { words: ["פינתאוכל"], name: "פינת אוכל", type: "living" },
  { words: ["סלון"], name: "סלון", type: "living" },
  { words: ["מטבח"], name: "מטבח", type: "kitchen" },
  { words: ["ממד", "מרחבמוגן"], name: "ממ״ד", type: "other" },
  { words: ["שירותים", "שרותים", "אסלה"], name: "שירותים", type: "bathroom" },
  { words: ["מקלחת"], name: "מקלחת", type: "bathroom" },
  { words: ["אמבטיה"], name: "אמבטיה", type: "bathroom" },
  { words: ["רחצה", "אמבט"], name: "חדר רחצה", type: "bathroom" },
  { words: ["כביסה"], name: "חדר כביסה", type: "other" },
  { words: ["שירות"], name: "חדר שירות", type: "other" },
  { words: ["מרפסת"], name: "מרפסת", type: "balcony" },
  { words: ["מסדרון"], name: "מסדרון", type: "hallway" },
  { words: ["מבואה"], name: "מבואה", type: "hallway" },
  { words: ["כניסה"], name: "כניסה", type: "hallway" },
  { words: ["מחסן"], name: "מחסן", type: "other" },
];
// Names for rooms recognised from their furniture or shape.
export const ROOM_GUESS = {
  bedroom: "חדר שינה",
  bathroom: "חדר רחצה",
  kitchen: "מטבח",
  living: "סלון",
  corridor: "מסדרון",
  numbered: (n) => `חדר ${n}`,
};

export const REVIEW_NOTE = "שינויים בקירות, בפתחים, במטבחים ובחדרי רחצה הם עקרוניים עד שיבדוק אותם איש מקצוע מוסמך.";

export const WIZARD = {
  presets: {
    "Living Room": "סלון",
    "Primary Bed": "חדר הורים",
    Kitchen: "מטבח",
    Bathroom: "חדר רחצה",
    "Home Office": "חדר עבודה",
    Custom: "מותאם אישית",
  },
  newRoom: "חדר חדש",
  unnamedRoom: "חדר ללא שם",
  roomId: (n) => `חדר R-${String(n).padStart(2, "0")}`,
  total: (value) => `סה״כ: ${value} ${UNITS.m2}`,
  configured: (n) => `${n} חדרים מוגדרים`,
  edit: (name) => `עריכת ${name}`,
  remove: (name) => `מחיקת ${name}`,
  copyOf: (name) => `${name} (עותק)`,
  nameEveryRoom: "תנו שם לכל חדר לפני יצירת הקנבס.",
  nameProject: "תנו שם לפרויקט.",
  storageBlocked: "הדפדפן חסם אחסון מקומי, ולכן אי אפשר לשמור את התוכנית. אפשרו אחסון אתרים ונסו שוב.",
};

export const EDITOR = {
  tools: {
    select: "בחירה והזזה",
    exterior: "שרטוט קיר חיצוני",
    partition: "שרטוט מחיצה",
    door: "הצבת דלת",
    window: "הצבת חלון",
    furniture: "קטלוג ריהוט",
  },
  placeFurniture: "הצבת ריהוט",
  crumbPlan: "עורך התוכנית",
  crumbDraft: "עורך התוכנית (טיוטה)",
  crumbVersion: (latest, dirty) => `עורך התוכנית (${latest ? `גרסה ${latest}` : "אין גרסאות"}${dirty ? ", נערך" : ""})`,
  zoom: (value) => `זום: ${value}`,
  saved: (n) => `נשמר · גרסה ${n}`,
  unsaved: "שינויים שלא נשמרו",
  nothingSaved: "עדיין לא נשמר דבר",
  draftSignedIn: "טיוטה · עדיין לא נשמרה בחשבון שלכם",
  draftGuest: "טיוטת אורח · נשמרת בדפדפן הזה בלבד",
  draftRole: "טיוטה",
  editingAs: (role) => `עריכה כ${ROLES[role] ?? role}`,
  allProjects: "כל הפרויקטים",
  untitled: "ללא שם",
  signOut: "התנתקות",
  signIn: "התחברות",
  selectWallFirst: "בחרו קיר, אחר כך בחרו בכלי דלת או חלון ולחצו Enter.",
  clickWall: "לחצו על קיר כדי להציב אותו שם.",
  loaded: (n) => `נטענה גרסה ${n}. שמרו כדי להפוך אותה לגרסה החדשה ביותר, או בטלו כדי לחזור.`,
  savedAs: (n) => `נשמר כגרסה ${n}`,
  title: (name) => `${name} · קנבס דו־ממדי`,
};

export const RENDER = {
  exteriorWall: "קיר חיצוני",
  partition: "מחיצה",
  door: "דלת",
  window: "חלון",
  wallLabel: (name, length) => `${name}, ${length} ${UNITS.m}`,
  openingLabel: (name, width) => `${name}, ברוחב ${width} ${UNITS.cm}`,
  furnitureLabel: (name, w, d) => `${name}, ${w} על ${d} ${UNITS.cm}`,
  roomLabel: (name, area) => `חדר ${name}, ${area} מטרים רבועים`,
};

export const PANEL = {
  title: "בוחן האלמנטים",
  nothingSelected: "לא נבחר דבר",
  kinds: { rooms: "חדר", walls: "קיר", openings: "פתח", furniture: "ריהוט" },
  activeSelection: "הבחירה הנוכחית",
  dimensions: "מידות",
  wall: { exterior: "קיר חיצוני", partition: "מחיצה" },
  opening: { door: "דלת", window: "חלון" },
  fields: {
    length: "אורך",
    thickness: "עובי",
    type: "סוג",
    width: "רוחב",
    fromWallStart: "מתחילת הקיר",
    widthX: "רוחב (X)",
    depthY: "עומק (Y)",
    rotation: "סיבוב",
    name: "שם",
    roomType: "סוג החדר",
  },
  exteriorOption: "חיצוני",
  partitionOption: "מחיצה",
  doorOption: "דלת",
  windowOption: "חלון",
  summary: "סיכום התוכנית",
  rooms: "חדרים",
  roomArea: "שטח החדרים",
  walls: "קירות",
  openings: "דלתות וחלונות",
  furniture: "ריהוט",
  hint: "בחרו כל פריט בקנבס כדי לערוך את מידותיו. גררו כדי להזיז, וגררו את קצות הקיר כדי לשנות את אורכו.",
  versions: "גרסאות התוכנית",
  saved: (n) => `${n} שמורות`,
  nothingSaved: "עדיין לא נשמר דבר.",
  loadVersion: "טעינת הגרסה הזו לקנבס",
  untitled: "ללא שם",
};

export const IMPORT = {
  errors: {
    too_large: "הקובץ גדול מדי. אפשר לייבא קובץ PDF עד 20 מ״ב.",
    not_pdf: "הקובץ אינו קובץ PDF. בחרו קובץ שרטוט בפורמט PDF.",
    encrypted: "הקובץ מוגן בסיסמה, ולכן אי אפשר לקרוא אותו. שמרו עותק ללא סיסמה ונסו שוב.",
    corrupt: "לא הצלחנו לקרוא את הקובץ. ייתכן שהוא פגום. נסו קובץ אחר.",
    generic: "הניתוח של השרטוט נכשל. נסו עמוד או קובץ אחר.",
  },
  analyzing: "קוראים את השרטוט…",
  pickPage: (count) => `בקובץ ${count} עמודים. באיזה מהם נמצאת תוכנית הקומה?`,
  pageOption: (n) => `עמוד ${n}`,
  confidence: {
    good: "הזיהוי נראה טוב. עדיין כדאי לעבור על הקירות מול השרטוט.",
    partial: "כדאי לבדוק היטב. חלק מהקירות כנראה חסרים או מיותרים. עברו על השרטוט ותקנו, אפשר להשלים בעורך.",
    weak: "הזיהוי חלש. סמנו אזור תוכנית, בחרו רק קירות שנראים נכונים, והשלימו את השאר בעורך.",
    none: "לא זוהו קירות.",
  },
  warnings: {
    no_scale: "לא נמצא בשרטוט קנה מידה כתוב. כדי להמשיך אשרו את קנה המידה המשוער או כיילו: סמנו קיר שאתם יודעים את אורכו.",
    no_vector: "השרטוט הוא תמונה סרוקה, ולכן אי אפשר לזהות בו קירות אוטומטית. אפשר להשתמש בו כרקע אחרי כיול, והתוכנית תתחיל ריקה.",
    no_walls: "לא זוהו קירות בעמוד הזה. נסו עמוד אחר, או השתמשו בשרטוט כרקע.",
    capped: "זוהו יותר מדי קירות והוצגו הארוכים ביותר.",
    out_of_range: "חלק מהקירות חרגו מגבולות התוכנית והושמטו.",
    furniture_capped: "זוהה ריהוט רב מדי והוצגו הפריטים הגדולים ביותר.",
  },
  scaleTitle: "קנה מידה",
  scaleDetected: (ratio) => `קנה המידה שזוהה: 1:${ratio}`,
  scaleCandidates: "נמצאו כמה קני מידה בעמוד. בחרו את זה של התוכנית:",
  scaleCalibrated: "קנה המידה כויל ידנית לפי קיר שסימנתם.",
  scaleMissing: "קנה המידה לא ידוע. כיול חובה לפני ההמשך.",
  scaleSuggested: (ratio) => `קנה מידה משוער: 1:${ratio} — אשרו או כיילו`,
  scaleConfirmed: (ratio) => `קנה המידה אושר: 1:${ratio}`,
  scaleSuggestedChoose: "אפשר לבחור קנה מידה אחר:",
  scaleConfirm: "אישור קנה המידה המשוער",
  areaHint: "הקווים המקווקווים מסמנים את אזור התוכנית. קירות מחוץ לו (טבלאות, מסגרת, מקרא) לא נכללים. אפשר לצייר אזור חדש על השרטוט או לאפס לזיהוי האוטומטי.",
  areaHintManual: "האזור סומן ידנית. קירות מחוץ לו לא נכללים.",
  areaDraw: "סימון אזור על השרטוט",
  areaDrawing: "גררו על השרטוט כדי לסמן את אזור התוכנית",
  areaReset: "איפוס לאוטומטי",
  sampleWall: (length) => `הקיר הארוך ביותר שזוהה: ${length} ${UNITS.m}. האם זה תואם את השרטוט?`,
  calibrate: "סמנו קיר שאתם יודעים את אורכו",
  calibrateHint: "לחצו על שתי נקודות בשרטוט בקצות מידה ידועה (אפשר להגדיל כדי לדייק).",
  calibrateMeasured: (length) => `המרחק שסימנתם כרגע: ${length} ${UNITS.m}`,
  realLength: "האורך האמיתי",
  unitM: "מטרים",
  unitCm: "סנטימטרים",
  apply: "עדכון קנה המידה",
  cancel: "ביטול",
  badLength: "הזינו אורך חיובי (למשל 4.5 במטרים), ושהנקודות שסומנו יהיו שונות.",
  badFactor: "היחס בין האורך שהוזן לאורך שנמדד לא סביר. בדקו את הנקודות והאורך.",
  opacity: "שקיפות השרטוט",
  wallsTitle: "הקירות שזוהו",
  wallsSelected: (on, total) => `${on} מתוך ${total} קירות נבחרו. לחצו על קיר כדי לבטל או להחזיר אותו.`,
  wallLabel: (n, length, on) => `קיר ${n}, ${length} ${UNITS.m}, ${on ? "נבחר" : "לא נבחר"}`,
  furnitureTitle: "ריהוט",
  furnitureSummary: (identified, unidentified) => `ריהוט: ${identified} זוהו, ${unidentified} לא זוהו`,
  furnitureSelected: (on, total) => `${on} מתוך ${total} פריטי ריהוט ייובאו. לחצו על פריט כדי לבטל או להחזיר אותו.`,
  furnitureUnidentifiedHint: "פריט שלא זוהה ייובא רק אחרי שתבחרו לו סוג.",
  furnitureNone: "לא זוהה ריהוט בשרטוט.",
  chooseType: "בחרו סוג",
  typeFor: (label) => `סוג הפריט: ${label}`,
  furnitureLabel: (label, w, d, on) => `${label}, ${w} על ${d} ס״מ, ${on ? "נבחר" : "לא נבחר"}`,
  furnitureLabelUnknown: (w, d) => `ריהוט שלא זוהה, ${w} על ${d} ס״מ. בחרו סוג כדי לייבא`,
  furnitureImport: "ייבוא",
  layerLegend: "מה להציג על השרטוט",
  layerAll: "הכל",
  layerWalls: "רק קירות",
  layerFurniture: "רק ריהוט",
  wallsAsFurniture: (n) => `${n} קירות עבים במיוחד זוהו כריהוט ולכן לא נספרו כקירות.`,
  roomsNone: "לא זוהו חדרים. אפשר להוסיף אותם בעורך.",
  roomsSummary: (on, total, area) => `${on} מתוך ${total} חדרים ייובאו, ${area} ${UNITS.m2} בסך הכול.`,
  roomImport: "ייבוא",
  roomName: "שם החדר",
  roomType: "סוג החדר",
  roomLabel: (name, area, on) => `${name}, ${area} ${UNITS.m2}, ${on ? "נבחר" : "לא נבחר"}`,
  zoomIn: "הגדלה",
  zoomOut: "הקטנה",
  zoomFit: "התאמה למסך",
  viewer: "השרטוט עם הקירות שזוהו. גררו להזזה, גלגלת העכבר להגדלה.",
  nameProject: "תנו שם לפרויקט.",
  needCalibration: "כיילו את קנה המידה לפני ההמשך.",
  chooseFile: "בחרו קובץ PDF.",
  backgroundNotKept: "לא הצלחנו לשמור את השרטוט כרקע בדפדפן הזה (האחסון חסום). התוכנית תיווצר בלי הרקע.",
  storageBlocked: "הדפדפן חסם אחסון מקומי, ולכן אי אפשר להמשיך. אפשרו אחסון אתרים ונסו שוב.",
};

export const EDITOR_UNDERLAY = {
  title: "שרטוט רקע",
  show: "הצגה",
  hide: "הסתרה",
  opacity: "שקיפות",
  localOnly: "השרטוט נשמר בדפדפן הזה בלבד.",
  missing: "השרטוט המקורי לא נמצא בדפדפן הזה, ולכן הוא לא מוצג.",
  lost: "לא הצלחנו לשמור את השרטוט בדפדפן. הוא יוצג עד סגירת הדף.",
};

export const WIZARD_IMPORT = { link: "ייבוא משרטוט PDF" };
