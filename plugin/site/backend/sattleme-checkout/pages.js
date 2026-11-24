// The plugin's HTML pages, served by its HTTP functions (http.js): the customer's payment page, the
// status page, for the merchant, and the page of an address that is not valid. Plain HTML,
// headings, tables, forms and inline SVG with presentation attributes: no script and no inline
// style, which Wix's own Content-Security-Policy blocks (measured on a Wix site: "default-src
// 'self'; script-src 'nonce-…'"). Their one stylesheet comes from the site's own origin (another
// HTTP function), which that policy allows; not measured on a Wix site: every page works without
// it. Every value is escaped.

import { REPORT_TRIES, STYLE_FUNCTION } from "./constants.js";
import { hasText, t, tn } from "./i18n.js";
import { qrModules } from "./sdk.js";

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The pages' headers. Measured on a Wix site: Wix serves an HTTP function's page with its own
// Content-Security-Policy ("default-src 'self'; script-src 'nonce-…'") in place of this one, so
// that its frame-ancestors 'none' is lost; X-Frame-Options says the same to browsers, for Wix to
// pass on (not measured yet). The other headers reached the browser as sent (measured).
export const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

// The pages' stylesheet (/_functions/sattlemeCheckoutStyle): the same for every site and visitor,
// so cached for an hour; nothing in it is loaded from elsewhere.
export const STYLE_HEADERS = {
  "Content-Type": "text/css; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
  "X-Content-Type-Options": "nosniff"
};

export const STYLESHEET = `body{margin:0;padding:16px;background:#ffffff;color:#0b1a33;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{margin:0 auto}
main.pay{max-width:30rem}
h1{font-size:1.5rem;line-height:1.25;margin:1rem 0 .5rem}
.qr{display:block;width:100%;max-width:20rem;height:auto}
textarea{box-sizing:border-box;width:100%;padding:.5rem;border:1px solid #9aa3b2;border-radius:4px;font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;resize:vertical}
a.wallet,button{display:inline-block;padding:.6rem 1.2rem;border:0;border-radius:6px;background:#e8ebf0;color:#0b1a33;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
a.wallet{background:#f7931a}
table{border-collapse:collapse}
th,td{text-align:left;vertical-align:top}
`;

// The sattle.me logo (its kit's colour version, for light backgrounds: docs/sattle-me.svg), inline,
// 160 px wide (the kit's least is 80 px): presentation attributes alone, which Wix's
// Content-Security-Policy lets through, and nothing loaded from elsewhere.
export const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 890.4 153.8" width="160" height="27.6" role="img" aria-label="sattle.me"><title>sattle.me</title><path fill="#0B1A33" d="M49.4 153.8Q31.4 153.8 18.1 145.3Q4.8 136.8 0 122.4L22 112Q26.2 120.8 33.4 125.8Q40.6 130.8 49.4 130.8Q55.8 130.8 59.2 128.2Q62.6 125.6 62.6 121Q62.6 118.6 61.4 116.9Q60.2 115.2 57.8 113.8Q55.4 112.4 51.8 111.4L33.2 106.2Q19.8 102.4 12.6 93.9Q5.4 85.4 5.4 73.8Q5.4 63.6 10.6 56Q15.8 48.4 25.2 44.1Q34.6 39.8 46.8 39.8Q62.8 39.8 74.9 47.3Q87 54.8 92 68.4L69.8 78.8Q67.4 72 61.1 67.9Q54.8 63.8 46.8 63.8Q41 63.8 37.7 66.2Q34.4 68.6 34.4 72.8Q34.4 75 35.6 76.8Q36.8 78.6 39.5 80Q42.2 81.4 46.2 82.6L63.6 87.8Q77.2 91.8 84.4 99.9Q91.6 108 91.6 119.8Q91.6 130 86.3 137.6Q81 145.2 71.6 149.5Q62.2 153.8 49.4 153.8ZM141 153.8Q129.2 153.8 120.6 150Q112 146.2 107.4 139.1Q102.8 132 102.8 122.2Q102.8 113 107 105.9Q111.2 98.8 119.9 94Q128.6 89.2 141.6 87.2L171.8 82.4V79.4Q171.8 73.2 166.9 69Q162 64.8 153.6 64.8Q145.6 64.8 139.5 69.2Q133.4 73.6 130.6 80.8L106.6 69.4Q109.8 60.2 116.8 53.6Q123.8 47 133.6 43.4Q143.4 39.8 155 39.8Q168.8 39.8 179.4 44.8Q190 49.8 195.9 58.7Q201.8 67.6 201.8 79.4V151.4H173.8V141Q172 143 170 144.4Q164.2 149.2 157 151.5Q149.8 153.8 141 153.8ZM171.8 104.4 147 108.8Q140.6 110 137.2 112.9Q133.8 115.8 133.8 121.2Q133.8 126.2 137.6 129Q141.4 131.8 147 131.8Q154.4 131.8 160 128.6Q165.6 125.4 168.7 119.9Q171.8 114.4 171.8 107.8ZM274 152.6Q254.2 152.6 243.3 141.9Q232.4 131.2 232.4 112V68.2H214V42.2H215Q223.4 42.2 227.9 38Q232.4 33.8 232.4 25.4V17.4H262.4V42.2H288V68.2H262.4V110Q262.4 115.6 264.4 119.3Q266.4 123 270.6 124.8Q274.8 126.6 281 126.6Q282.4 126.6 284.2 126.4Q286 126.2 288 126V151.4Q285 151.8 281.2 152.2Q277.4 152.6 274 152.6ZM355.8 152.6Q336 152.6 325.1 141.9Q314.2 131.2 314.2 112V68.2H295.8V42.2H296.8Q305.2 42.2 309.7 38Q314.2 33.8 314.2 25.4V17.4H344.2V42.2H369.8V68.2H344.2V110Q344.2 115.6 346.2 119.3Q348.2 123 352.4 124.8Q356.6 126.6 362.8 126.6Q364.2 126.6 366 126.4Q367.8 126.2 369.8 126V151.4Q366.8 151.8 363 152.2Q359.2 152.6 355.8 152.6ZM385 151.4V0H415V151.4ZM487.2 153.8Q469.8 153.8 457 146.1Q444.2 138.4 437.2 125.4Q430.2 112.4 430.2 96.6Q430.2 80.2 437.5 67.4Q444.8 54.6 457.2 47.2Q469.6 39.8 485.2 39.8Q498.2 39.8 508.2 43.9Q518.2 48 525.1 55.4Q532 62.8 535.6 72.5Q539.2 82.2 539.2 93.6Q539.2 96.8 538.9 99.9Q538.6 103 537.8 105.2H461.4Q461.8 109.4 463.4 113Q466.4 120 472.6 123.9Q478.8 127.8 487.6 127.8Q495.6 127.8 501.3 124.6Q507 121.4 510.2 115.8L534.2 127.2Q531 135.2 524.1 141.2Q517.2 147.2 507.8 150.5Q498.4 153.8 487.2 153.8ZM462 83.2H507.4Q507.2 80.6 506.4 78.2Q504.2 71.6 498.7 67.7Q493.2 63.8 485.2 63.8Q477.4 63.8 471.8 67.6Q466.2 71.4 463.4 78.8Q462.6 80.8 462 83.2Z"/><circle fill="#F7931A" cx="570.8" cy="131.8" r="19.6"/><path fill="#F7931A" d="M602.4 151.4V42.2H630.4V55.4Q633.4 49.4 639 45.8Q648.2 39.8 661 39.8Q674.6 39.8 685 46.6Q691 50.8 694.2 56.4Q698.6 50 704.6 46.2Q714.6 39.8 728 39.8Q739.8 39.8 748.9 45Q758 50.2 763.2 59.5Q768.4 68.8 768.4 81.2V151.4H738.4V87.6Q738.4 81.2 736.1 76.6Q733.8 72 729.6 69.4Q725.4 66.8 719.4 66.8Q713.6 66.8 709.3 69.4Q705 72 702.7 76.6Q700.4 81.2 700.4 87.6V151.4H670.4V87.6Q670.4 81.2 668.1 76.6Q665.8 72 661.6 69.4Q657.4 66.8 651.4 66.8Q645.6 66.8 641.3 69.4Q637 72 634.7 76.6Q632.4 81.2 632.4 87.6V151.4ZM838.4 153.8Q821 153.8 808.2 146.1Q795.4 138.4 788.4 125.4Q781.4 112.4 781.4 96.6Q781.4 80.2 788.7 67.4Q796 54.6 808.4 47.2Q820.8 39.8 836.4 39.8Q849.4 39.8 859.4 43.9Q869.4 48 876.3 55.4Q883.2 62.8 886.8 72.5Q890.4 82.2 890.4 93.6Q890.4 96.8 890.1 99.9Q889.8 103 889 105.2H812.6Q813 109.4 814.6 113Q817.6 120 823.8 123.9Q830 127.8 838.8 127.8Q846.8 127.8 852.5 124.6Q858.2 121.4 861.4 115.8L885.4 127.2Q882.2 135.2 875.3 141.2Q868.4 147.2 859 150.5Q849.6 153.8 838.4 153.8ZM813.2 83.2H858.6Q858.4 80.6 857.6 78.2Q855.4 71.6 849.9 67.7Q844.4 63.8 836.4 63.8Q828.6 63.8 823 67.6Q817.4 71.4 814.6 78.8Q813.8 80.8 813.2 83.2Z"/></svg>`;

/**
 * A page; `refreshSeconds`: the browser loads it again that often (a meta refresh); `pay`: the
 * payment page, in a narrow column.
 */
function page(language, title, body, { refreshSeconds = 0, pay = false } = {}) {
  const refresh = refreshSeconds
    ? `<meta http-equiv="refresh" content="${Number(refreshSeconds)}">`
    : "";
  return `<!doctype html><html lang="${escapeHtml(language)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">${refresh}
<link rel="stylesheet" href="${STYLE_FUNCTION}">
<title>${escapeHtml(title)}</title></head><body><main${pay ? ' class="pay"' : ""}>
<p>${LOGO}</p>
${body}
</main></body></html>`;
}

// The job runs hourly, within 5 minutes of its time (Wix's docs): late once its last run started
// longer ago than this.
const JOB_LATE_MS = 70 * 60000;

/**
 * The time zone the status page shows its times in: `zone`, the site's (an IANA name, as Wix's
 * General Info gives it, "Europe/Zurich"), when this runtime knows it; else null, for UTC.
 */
export function timeZoneOf(zone) {
  if (typeof zone !== "string" || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(zone)) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch (error) {
    return null;
  }
}

/**
 * A date to the second, in time zone `zone` (timeZoneOf), else in UTC: "2026-10-14 12:30:05"; "–"
 * for none. The page says once which zone its times are in.
 */
export function when(ms, zone) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "–";
  const utc = new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  if (!zone) return utc;
  try {
    const parts = {};
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(new Date(ms))) {
      parts[part.type] = part.value;
    }
    const text = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
    return /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(text) ? text : utc;
  } catch (error) {
    return utc;
  }
}

/** A cell: its text, escaped; a link when it is `{ text, href }`. */
function cell(value) {
  if (value && typeof value === "object") {
    const href = escapeHtml(value.href);
    return `<td><a href="${href}" rel="noreferrer noopener">${escapeHtml(value.text)}</a></td>`;
  }
  return `<td>${escapeHtml(value)}</td>`;
}

function table(language, columns, rows) {
  if (!rows.length) return `<p>${escapeHtml(t(language, "status.none"))}</p>`;
  const head = columns.map((key) => `<th>${escapeHtml(t(language, key))}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map(cell).join("")}</tr>`).join("\n");
  return `<table border="1" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

/** A deposit address, as its page on mempool.space; "–" for none. */
function addressCell(address) {
  return typeof address === "string" && /^bc1p[a-z0-9]{58}$/.test(address)
    ? { text: address, href: `https://mempool.space/address/${address}` }
    : "–";
}

/** A check's error in plain words, its code after them; "" for none. */
function errorText(language, code) {
  if (!code) return "";
  return hasText(`error.${code}`) ? `${t(language, `error.${code}`)} (${code})` : code;
}

/**
 * Whether a payment's task was made: made; refused by Wix after its tries, and why; not made yet,
 * its tries and why the last failed (made again at the next check); being made; none.
 */
function taskState(language, row) {
  const reason = row.taskError || "";
  if (row.task === "done") return t(language, "taskState.done");
  if (row.task === "failed") {
    return reason
      ? `${t(language, "taskState.failed")}: ${reason}`
      : t(language, "taskState.failed");
  }
  if (row.task === "todo" || row.task === "sending") {
    if (!reason) return t(language, "taskState.pending");
    const values = { tries: String(row.tries), max: String(REPORT_TRIES), reason };
    return t(language, "taskState.trying", values);
  }
  return "–";
}

/** A warning kept for the status page: the SDK's (its own words), or the plugin's. */
function warningText(language, warning) {
  if (warning.kind === "lightningOnly") return t(language, "warning.lightningOnly", warning);
  return `${t(language, "warning.sdk")} ${warning.text || ""}`.trim();
}

/**
 * The form that asks for the status page's token (posted, never in an address). A browser does not
 * send a token shorter than its minlength, and may say nothing (measured): the page says it.
 */
export function tokenPage(language, message) {
  const title = t(language, "status.title");
  const note = message ? `<p><strong>${escapeHtml(message)}</strong></p>` : "";
  return page(
    language,
    title,
    `<h1>${escapeHtml(title)}</h1>${note}
<form method="post" action="" autocomplete="off">
<p><label>${escapeHtml(t(language, "status.tokenLabel"))}<br>
<input type="password" name="t" minlength="32" maxlength="200" required aria-describedby="hint"></label></p>
<p id="hint">${escapeHtml(t(language, "status.tokenHint"))}</p>
<p><button type="submit">${escapeHtml(t(language, "status.submit"))}</button></p>
</form>`
  );
}

/** A page with a title and one sentence. */
export function messagePage(language, titleKey, textKey, values) {
  const title = t(language, titleKey, values);
  return page(
    language,
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(t(language, textKey, values))}</p>`
  );
}

/**
 * The page of an underpayment that expired (http.js): what came of what the invoice asked, that
 * the order is not paid and that the shop settles it, and the way back to the shop (Wix's pending
 * page), never to pay again: the customer learns there what the merchant's note says. No refresh:
 * nothing changes it.
 */
export function underpaidPage(language, view) {
  const title = t(language, "page.underpaidTitle");
  const parts = [`<h1>${escapeHtml(title)}</h1>`];
  const text = t(language, "page.underpaid", { received: view.received, sats: view.sats });
  parts.push(`<p><strong>${escapeHtml(text)}</strong></p>`);
  if (view.back) {
    parts.push(
      `<p><a href="${escapeHtml(view.back)}">${escapeHtml(t(language, "page.back"))}</a></p>`
    );
  }
  return page(language, title, parts.join("\n"), { pay: true });
}

/**
 * The status page: `view` as http.js gathers it (versions, connection, the site's URL, the job's
 * last runs, the payments under way and those that need the merchant, refusals, warnings).
 */
export function statusPage(language, view) {
  const parts = [`<h1>${escapeHtml(t(language, "status.title"))}</h1>`];
  parts.push(`<p>${escapeHtml(t(language, "status.versions", view.versions))}</p>`);
  // Its times in the site's time zone (Wix's General Info), else in UTC.
  const zone = timeZoneOf(view.timeZone);
  const zoneText = zone
    ? t(language, "status.timeZone", { zone })
    : t(language, "status.timeZoneUtc");
  parts.push(`<p>${escapeHtml(zoneText)}</p>`);

  parts.push(`<h2>${escapeHtml(t(language, "status.connection"))}</h2>`);
  if (view.refusedConnection) {
    const facts = { at: when(view.refusedConnection.at, zone), code: view.refusedConnection.code };
    parts.push(
      `<p><strong>${escapeHtml(t(language, "status.connectRefused", facts))}</strong></p>`
    );
  }
  if (!view.keyPresent) {
    parts.push(`<p><strong>${escapeHtml(t(language, "refusal.no_key"))}</strong></p>`);
  } else if (view.merchant && view.merchant.ok) {
    const merchant = tn(language, "status.merchant", view.merchant.addresses, view.merchant);
    parts.push(`<p>${escapeHtml(merchant)}</p>`);
    if (view.minutesToPay !== null) {
      const minutes = { minutes: String(view.minutesToPay) };
      const text = tn(language, "status.minutes", view.minutesToPay, minutes);
      parts.push(`<p>${escapeHtml(text)}</p>`);
    }
  } else {
    const code = view.merchant ? view.merchant.code : "unexpected";
    parts.push(
      `<p><strong>${escapeHtml(t(language, "status.merchantFailed", { code }))}</strong></p>`
    );
  }

  parts.push(`<h2>${escapeHtml(t(language, "status.page"))}</h2>`);
  const siteKey = view.site.valid ? "status.siteSaved" : "status.siteInvalid";
  parts.push(`<p>${escapeHtml(t(language, siteKey, { url: view.site.url || "–" }))}</p>`);

  parts.push(`<h2>${escapeHtml(t(language, "status.jobs"))}</h2>`);
  parts.push(`<p>${escapeHtml(t(language, "status.jobsNote"))}</p>`);
  if (!view.runs.length) {
    parts.push(`<p><strong>${escapeHtml(t(language, "status.jobsNone"))}</strong></p>`);
  } else if (view.now - view.runs[0].startedAt > JOB_LATE_MS) {
    parts.push(`<p><strong>${escapeHtml(t(language, "status.jobsLate"))}</strong></p>`);
  }
  parts.push(
    table(
      language,
      ["col.start", "col.end", "col.checks", "col.errors", "col.left"],
      view.runs.map((run) => [
        when(run.startedAt, zone),
        when(run.endedAt, zone),
        String(run.checks),
        String(run.errors),
        String(run.left || 0)
      ])
    )
  );

  parts.push(`<h2>${escapeHtml(t(language, "status.attention"))}</h2>`);
  parts.push(`<p>${escapeHtml(t(language, "status.attentionNote"))}</p>`);
  parts.push(
    table(
      language,
      [
        "col.ref",
        "col.order",
        "col.reason",
        "col.at",
        "col.received",
        "col.due",
        "col.address",
        "col.task"
      ],
      view.attention.map((p) => [
        p.ref || "–",
        p.orderId || "–",
        t(language, `reason.${p.reason}`),
        when(p.at, zone),
        p.received,
        p.due || "–",
        addressCell(p.address),
        taskState(language, p)
      ])
    )
  );

  parts.push(`<h2>${escapeHtml(t(language, "status.open"))}</h2>`);
  parts.push(
    table(
      language,
      [
        "col.ref",
        "col.state",
        "col.received",
        "col.due",
        "col.address",
        "col.expires",
        "col.lastCheck",
        "col.error"
      ],
      view.open.map((p) => [
        p.ref || "–",
        t(language, `state.${p.state}`),
        p.received,
        p.due || "–",
        addressCell(p.address),
        when(p.expiresAt, zone),
        when(p.lastCheck, zone),
        errorText(language, p.error)
      ])
    )
  );

  parts.push(`<h2>${escapeHtml(t(language, "status.refusals"))}</h2>`);
  parts.push(
    table(
      language,
      ["col.at", "col.reason", "col.count"],
      view.refusals.map((r) => [
        when(r.at, zone),
        `${r.errorCode}${r.currency ? ` (${r.currency})` : ""}`,
        String(r.count)
      ])
    )
  );

  if (view.warnings.length) {
    parts.push(`<h2>${escapeHtml(t(language, "status.warnings"))}</h2>`);
    parts.push(
      table(
        language,
        ["col.at", "col.message", "col.count"],
        view.warnings.map((w) => [when(w.at, zone), warningText(language, w), String(w.count)])
      )
    );
  }
  return page(language, t(language, "status.title"), parts.join("\n"));
}

// A payment page loads itself again this often, and checks the payment as it loads (at most every
// 5 s: http.js): while the invoice can be paid, and, less often, while it is being confirmed.
export const PAGE_REFRESH_SECONDS = 10;
export const CONFIRM_REFRESH_SECONDS = 30;
// A QR code's modules, in CSS pixels, and its quiet zone, in modules (ISO/IEC 18004: 4); without
// the stylesheet, no wider than a phone's screen (320 px, its margins left aside).
const QR_MODULE_PX = 4;
const QR_QUIET = 4;
const QR_MAX_PX = 288;

/**
 * The QR code of `text` as inline SVG: its dark modules as one path, row by row, drawn on white
 * with its quiet zone; presentation attributes alone. Nothing of `text` is written in the SVG.
 */
export function qrSvg(text, label) {
  const modules = qrModules(text);
  const size = modules.length;
  const full = size + 2 * QR_QUIET;
  const runs = [];
  modules.forEach((row, y) => {
    for (let x = 0; x < size; x += 1) {
      if (!row[x]) continue;
      let end = x;
      while (end < size && row[end]) end += 1;
      runs.push(`M${x + QR_QUIET} ${y + QR_QUIET}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  const px = Math.min(full * QR_MODULE_PX, QR_MAX_PX);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="qr" viewBox="0 0 ${full} ${full}" width="${px}" ` +
    `height="${px}" shape-rendering="crispEdges" role="img" aria-label="${escapeHtml(label)}">` +
    `<rect width="${full}" height="${full}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${runs.join("")}"/></svg>`
  );
}

/** A value to copy, in a read-only text area: selectable, and wrapped however long it is. */
function copyable(label, value, rows) {
  return (
    `<p><label>${escapeHtml(label)}<br><textarea readonly rows="${rows}" cols="44" ` +
    `spellcheck="false">${escapeHtml(value)}</textarea></label></p>`
  );
}

/**
 * The customer's payment page: `view` as http.js gathers it (the amount, the time left, the
 * invoice or the rest of an underpayment, the confirmations of an on-chain payment, or, paid, that
 * the order is being recorded). No script:
 * it loads itself again (a meta refresh), and a button checks again.
 */
export function paymentPage(language, view) {
  const title = t(language, "page.title");
  const parts = [`<h1>${escapeHtml(title)}</h1>`];
  const amount = view.price
    ? t(language, "page.amountPrice", { sats: view.sats, price: view.price })
    : t(language, "page.amount", { sats: view.sats });
  parts.push(`<p><strong>${escapeHtml(amount)}</strong></p>`);
  let refresh = PAGE_REFRESH_SECONDS;
  if (view.state === "paid") {
    // Paid, Wix being told: the page goes on to Wix's success page once it is.
    parts.push(`<p>${escapeHtml(t(language, "page.recording"))}</p>`);
  } else if (view.state === "unconfirmed") {
    refresh = CONFIRM_REFRESH_SECONDS;
    const confirmations = { confirmations: String(view.confirmations || 0) };
    parts.push(`<p>${escapeHtml(t(language, "page.confirming", confirmations))}</p>`);
    // Back to the shop: Wix's pending page (its success page when Wix gave no pending one).
    if (view.back) {
      parts.push(
        `<p><a href="${escapeHtml(view.back)}">${escapeHtml(t(language, "page.back"))}</a></p>`
      );
    }
  } else if (view.secondsLeft <= 0) {
    parts.push(`<p>${escapeHtml(t(language, "page.timeUp"))}</p>`);
  } else {
    const left = {
      minutes: String(Math.floor(view.secondsLeft / 60)),
      seconds: String(view.secondsLeft % 60)
    };
    parts.push(`<p>${escapeHtml(t(language, "page.timeLeft", left))}</p>`);
    const rest = view.rest;
    if (rest) {
      const values = { received: view.received, sats: view.sats, rest: rest.sats };
      parts.push(`<p>${escapeHtml(t(language, "page.rest", values))}</p>`);
    }
    const uri = rest ? rest.paymentUri : view.paymentUri;
    const bolt11 = rest ? rest.bolt11 : view.bolt11;
    if (uri) {
      parts.push(`<p>${escapeHtml(t(language, "page.scan"))}</p>`);
      parts.push(`<p>${qrSvg(uri, t(language, "page.qr"))}</p>`);
      parts.push(
        `<p><a class="wallet" href="${escapeHtml(uri)}">${escapeHtml(t(language, "page.openWallet"))}</a></p>`
      );
      if (bolt11) parts.push(copyable(t(language, "page.invoice"), bolt11, 6));
      // The rest is payable on-chain to the invoice's address when its URI is a bitcoin: one.
      if (view.address && (!rest || /^bitcoin:/i.test(uri))) {
        parts.push(copyable(t(language, "page.address"), view.address, 2));
      }
    } else {
      parts.push(`<p>${escapeHtml(t(language, "page.restPending"))}</p>`);
    }
  }
  parts.push(
    `<form method="get" action=""><input type="hidden" name="o" value="${escapeHtml(view.paymentId)}">` +
      `<input type="hidden" name="k" value="${escapeHtml(view.key)}">` +
      `<button type="submit">${escapeHtml(t(language, "page.checkAgain"))}</button></form>`
  );
  parts.push(`<p>${escapeHtml(t(language, "page.refresh", { seconds: String(refresh) }))}</p>`);
  return page(language, title, parts.join("\n"), { refreshSeconds: refresh, pay: true });
}
