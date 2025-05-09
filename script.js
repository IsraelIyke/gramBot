const puppeteer = require("puppeteer");
const axios = require("axios");
const { format } = require("date-fns");
const dns = require("dns");

// Configuration
const CONFIG = {
  website_url: "https://page-bot-three.vercel.app/",
  login_email: "test@example.com",
  login_password: "password123",
  login_button_selector: "#login-form button",
  post_login_button_selector:
    "div:nth-child(2) > table > tbody > tr > td:nth-child(4) > a > button",
  monitor_text: "Passport",
  telegram_bot_token: "7973821897:AAFh6QJoJZ2Ldee7XQnFZTX1bRe2vXbAMCs",
  telegram_chat_id: "1456972620",
  network_timeout: 15000, // 15 seconds
  max_retries: 3,
  telegram_api_ips: ["149.154.167.220", "149.154.167.221"], // Telegram API IP fallbacks
};

// Force DNS settings (Google + Cloudflare)
dns.setServers(["8.8.8.8", "1.1.1.1"]);

function log(message) {
  const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");
  console.log(`[${timestamp}] ${message}`);
}

async function sendTelegramNotification(message) {
  let attempts = 0;
  const telegramUrls = [
    `https://api.telegram.org/bot${CONFIG.telegram_bot_token}/sendMessage`,
    ...CONFIG.telegram_api_ips.map(
      (ip) => `https://${ip}/bot${CONFIG.telegram_bot_token}/sendMessage`
    ),
  ];

  while (attempts < CONFIG.max_retries) {
    const currentUrl = telegramUrls[attempts % telegramUrls.length];
    const isIpAddress = currentUrl.includes("https://14");

    try {
      log(`Attempt ${attempts + 1}: Sending via ${isIpAddress ? "IP" : "DNS"}`);

      const response = await axios.post(
        currentUrl,
        {
          chat_id: CONFIG.telegram_chat_id,
          text: message,
          parse_mode: "HTML",
        },
        {
          timeout: CONFIG.network_timeout,
          headers: isIpAddress ? { Host: "api.telegram.org" } : {},
          family: 4, // Force IPv4
        }
      );

      if (response.status === 200) {
        log("Notification sent successfully");
        return true;
      }
      log(`Unexpected status: ${response.status}`);
    } catch (e) {
      log(`Attempt ${attempts + 1} failed: ${e.code || e.message}`);

      // Special handling for certificate issues with IP
      if (e.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" && isIpAddress) {
        log("Bypassing SSL verification for IP fallback");
        try {
          const insecureResponse = await axios.post(
            currentUrl,
            {
              chat_id: CONFIG.telegram_chat_id,
              text: message,
              parse_mode: "HTML",
            },
            {
              timeout: CONFIG.network_timeout,
              headers: { Host: "api.telegram.org" },
              httpsAgent: new (require("https").Agent)({
                rejectUnauthorized: false,
              }),
            }
          );
          if (insecureResponse.status === 200) return true;
        } catch (insecureError) {
          log(`Insecure fallback failed: ${insecureError.message}`);
        }
      }
    }

    attempts++;
    if (attempts < CONFIG.max_retries) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempts));
    }
  }

  log("All notification attempts failed");
  return false;
}

async function setupPuppeteer() {
  log("Setting up Puppeteer");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1920,1080",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  return { browser, page };
}

async function loginToWebsite(page) {
  try {
    log(`Navigating to ${CONFIG.website_url}`);
    await page.goto(CONFIG.website_url, {
      waitUntil: "networkidle2",
      timeout: CONFIG.network_timeout,
    });

    log("Filling login form");
    await page.waitForSelector('[name="email"]', {
      visible: true,
      timeout: CONFIG.network_timeout,
    });
    await page.type('[name="email"]', CONFIG.login_email);
    await page.type('[name="password"]', CONFIG.login_password);

    log("Submitting login");
    await page.click(CONFIG.login_button_selector);
    await page.waitForSelector("#dashboard-page", {
      visible: true,
      timeout: CONFIG.network_timeout,
    });
    return true;
  } catch (e) {
    log(`Login failed: ${e.message}`);
    return false;
  }
}

async function clickPassportButton(page) {
  try {
    log("Waiting for services table");
    await page.waitForSelector("#dataTableServices", {
      visible: true,
      timeout: CONFIG.network_timeout,
    });

    log("Locating passport button");
    const button = await page.$(CONFIG.post_login_button_selector);
    if (!button) throw new Error("Button not found");

    await button.click();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return true;
  } catch (e) {
    log(`Passport button failed: ${e.message}`);
    return false;
  }
}

async function checkForText(page) {
  try {
    const content = await page.content();
    const found = content
      .toLowerCase()
      .includes(CONFIG.monitor_text.toLowerCase());
    log(found ? `Found text: "${CONFIG.monitor_text}"` : `Text not found`);
    return found;
  } catch (e) {
    log(`Text check failed: ${e.message}`);
    return false;
  }
}

async function main() {
  log("Starting monitoring process");
  const { browser, page } = await setupPuppeteer();

  try {
    if (!(await loginToWebsite(page))) return;
    if (!(await clickPassportButton(page))) return;

    if (await checkForText(page)) {
      const msg =
        `🚨 Passport Status Update\n` +
        `Found "${CONFIG.monitor_text}" at ${format(new Date(), "PPpp")}\n` +
        `URL: ${CONFIG.website_url}`;
      await sendTelegramNotification(msg);
    } else {
      log("Target text not found");
    }
  } catch (e) {
    log(`Critical error: ${e.message}`);
  } finally {
    await browser.close();
    log("Monitoring completed");
  }
}

// Error handling for uncaught exceptions
process.on("unhandledRejection", (reason, promise) => {
  log(`Unhandled rejection at: ${promise}, reason: ${reason}`);
});

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}`);
});

main().catch((err) => log(`Main error: ${err.message}`));
