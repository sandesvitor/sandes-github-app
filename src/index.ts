import { App } from "@octokit/app";
import {
  handleRequest,
  handleDBAReview,
  handleBadDatabaseVerbs,
} from "./handlers/handlers";

/*
 * ##########################################################################################
 *
 * CLOUDFLARE WORKERS ENVIRONMENT VARIABLES
 *
 * ##########################################################################################
 */
// @ts-ignore
const appId = APP_ID;
// @ts-ignore
const secret = WEBHOOK_SECRET;
//@ts-ignore
const privateKey = [PRIVATE_KEY_1, PRIVATE_KEY_2, PRIVATE_KEY_3].join("\n");

/*
 * ##########################################################################################
 *
 * LOCAL VARIABLES
 *
 * ##########################################################################################
 */
const APP_NAME: string = "dba-sheriff";
const BAD_VERBS: any = ["DELETE", "DROP", "ALTER", "CREATE INDEX"];
const WEBHOOK_EVENTS: any = [
  "pull_request.opened",
  "pull_request.synchronize",
  "pull_request_review.submitted",
];
const DBA_TEAM_NAME: string = "devops-dba";

const app: App = new App({
  appId,
  privateKey,
  webhooks: {
    secret,
  },
});

/*
 * ##########################################################################################
 *
 * IMPLEMENTING WEBHOOKS EVENTS
 *
 * ##########################################################################################
 */
app.webhooks.on(WEBHOOK_EVENTS, async ({ octokit, payload }: any) => {
  if (payload.action === "submitted") {
    console.info(`[Webhook - event {pull_request_review.submitted}]`);
    try {
      await handleDBAReview(octokit, payload, APP_NAME, DBA_TEAM_NAME);
    } catch (e: any) {
      console.info(
        `Error on handling PR webhook [handleDBAReview]: ${e.message}`
      );
    }

    return;
  }

  if (payload.action === "opened" || payload.action === "synchronize") {
    const prURL = payload.pull_request.html_url;
    const prAuthor = payload.pull_request.user.login;
    const repo = payload.repository.name;

    console.log(
      `[Webhook - events {pull_request.opened,  pull_request.synchronize}]: repo [${repo}]; URL [${prURL}]; author [${prAuthor}]`
    );

    try {
      await handleBadDatabaseVerbs(octokit, payload, APP_NAME, BAD_VERBS, DBA_TEAM_NAME);
    } catch (e: any) {
      console.log(
        `Error on handling PR webhook [handleBadDatabaseVerbs]: ${e.message}`
      );
    }

    return;
  }
});

/*
 * ##########################################################################################
 *
 * CONFIGURE EVENT LISTENERS TO WEBHOOK URL
 *
 * ##########################################################################################
 */
addEventListener("fetch", (event: any) => {
  console.log(`[LOG] Inside event listener ${event.request.method} /`);
  event.respondWith(handleRequest(event.request, app));
});
