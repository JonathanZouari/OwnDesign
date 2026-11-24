// Classic (blocking) script in <head>: sets the page direction before first paint, so a Hebrew
// visitor never sees the layout flip. The full engine is js/i18n.js.
(function () {
  var lang = "en";
  try {
    if (localStorage.getItem("atelier.lang") === "he") lang = "he";
  } catch (e) {
    // storage blocked: stay in English
  }
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
})();
