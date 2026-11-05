const fs = require("fs");
const html = fs.readFileSync("docs/Mes comptes.html", "utf8");
const i = html.indexOf("YANN DE CHAMPLAIN</");
const j = html.indexOf("YANN DE CHAMPLAIN", html.indexOf("Total des actifs"));
console.log("pos", j);
console.log(html.slice(j - 1600, j + 2200));
