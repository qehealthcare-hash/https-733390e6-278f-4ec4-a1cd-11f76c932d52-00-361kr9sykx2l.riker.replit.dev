var token = process.argv[2];
var projectIdOrName = process.argv[3];
var key = process.argv[4];
var value = process.argv[5];
var teamSlug = process.argv[6] || "";
var target = process.argv[7] || "production";

if (!token || !projectIdOrName || !key || typeof value === "undefined") {
  console.error(
    "Usage: node scripts/vercel-set-env.mjs <token> <projectIdOrName> <key> <value> [teamSlug] [target]"
  );
  process.exit(1);
}

async function setEnv() {
  var url = "https://api.vercel.com/v10/projects/" + encodeURIComponent(projectIdOrName) + "/env";
  if (teamSlug) {
    url += "?slug=" + encodeURIComponent(teamSlug);
  }
  var response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      key: key,
      value: value,
      target: [target],
      type: "encrypted"
    })
  });
  var json = await response.json();
  if (!response.ok) {
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));
}

setEnv().catch(function onError(error) {
  console.error(error);
  process.exit(1);
});
