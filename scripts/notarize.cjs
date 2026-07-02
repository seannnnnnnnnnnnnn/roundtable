const { notarize } = require("@electron/notarize");
const path = require("node:path");

module.exports = async function notarizeMac(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const appleApiKey = process.env.APPLE_API_KEY;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;

  if (appleApiKey && appleApiKeyId && appleApiIssuer) {
    await notarize({
      appPath,
      tool: "notarytool",
      appleApiKey,
      appleApiKeyId,
      appleApiIssuer
    });
    return;
  }

  if (appleId && appleIdPassword && teamId) {
    await notarize({
      appPath,
      tool: "notarytool",
      appleId,
      appleIdPassword,
      teamId
    });
  }
};
