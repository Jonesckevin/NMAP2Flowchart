/**
 * draw.io PostConfig override for the NMAP import plugin.
 *
 * draw.io loads js/PreConfig.js before app.min.js and js/PostConfig.js after it
 * (see js/bootstrap.js), which is the supported place to change globals and to
 * pull in code that needs the editor API.
 *
 * By the time this file runs, Draw.loadPlugin exists, so registering here works
 * whether or not the editor UI has been built yet: draw.io either queues the
 * callback or calls it straight away with the EditorUi instance.
 */
// Stock PostConfig content: the remote icon-search endpoints are not part of
// the standalone editor, so keep them disabled.
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;

(function () {
  var src = (window.PLUGINS_BASE_PATH || '') + 'plugins/nmap2drawio.js';

  // mxscript is draw.io's own loader; fall back to a plain script element when
  // the deployed build does not expose it.
  if (typeof window.mxscript === 'function') {
    window.mxscript(src);
    return;
  }

  var script = document.createElement('script');
  script.src = src;
  script.async = false;
  document.head.appendChild(script);
})();
