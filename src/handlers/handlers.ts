
import * as GithubFunction from "../api/github"
import { App } from "@octokit/app";

export async function handleRequest(request: any, app: App) {
  if (request.method === "GET") {
    const { data } = await app.octokit.request("GET /app");

    return new Response(`{ "ok": true }`, {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
  }

  const id = request.headers.get("x-github-delivery");
  const name = request.headers.get("x-github-event");
  const payload = await request.json();

  try {
    // TODO: implement signature verification
    // https://github.com/gr2m/cloudflare-worker-github-app-example/issues/1
    await app.webhooks.receive({
      id,
      name,
      payload,
    });

    return new Response(`{ "ok": true }`, {
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    app.log.error(e);

    return new Response(`{ "error": "${e.message}" }`, {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export async function handleDBAReview(
  octokit: App["octokit"],
  payload: any,
  appName: string,
  dbaTeamName: string,
) {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const pull_number = payload.pull_request.number;

  const dbaMembers = await GithubFunction.getDBATeamMembers(octokit, {owner, team_slug: dbaTeamName})

  console.info(`[handleDBAReview - Getting PR informations getDBATeamMembers]: ${JSON.stringify(dbaMembers)}`)

  console.info(`[handleDBAReview - Getting PR informations]: getPullRequestReviews`)
  const pullRequestReviews = await GithubFunction.getPullRequestReviews(octokit, {owner, repo, pull_number}).then((res: any) => res.data)

  const botPullRequestReviews = pullRequestReviews
    .filter((review: any) => review.user.login === `${appName}[bot]`)
    .map((data: any) => { return {review_id: data.id, file_path: data.body, state: data.state} })

  const pullRequestApprovals = pullRequestReviews
    .filter((review: any) => review.state === 'APPROVED' && dbaMembers.some((member: any) => review.user.login.includes(member)))
    .map((review: any) => { return {review_author: review.user.login, review_id: review.id, state: review.state} })

  console.info(
    `[handleDBAReview - After PR informations]: botPullRequestReviews
    ${JSON.stringify(botPullRequestReviews)}`)
  
  console.info(
    `[handleDBAReview - After PR informations]: getPullRequestReviews
    ${JSON.stringify(pullRequestApprovals)}`)

  const botOpenReviews = botPullRequestReviews.filter((review: any) => review.state === 'CHANGES_REQUESTED');
  
  if (botOpenReviews.length === 0){
    console.info(`[handleDBAReview - No reviews with status 'CHANGES_REQUESTED', returning`)
    return
  }

  // checking if DBA team approved PR (in this case return)
  if (pullRequestApprovals.length > 0){
    
    console.info(`[handleDBAReview - Dismissing reviews]: Pull Request approved by DBA team, dismissing reviews`)

    for (const review of botOpenReviews){
      console.info(`[handleDBAReview - Dismissing reviews]: dismissing review number [${review.review_id}]`)
      await GithubFunction.dismissReviewForPullRequest(octokit, {owner, repo, pull_number, review_id: review.review_id, message: `Review ${review.review_id} dismissed due to DBA team PR approval`});
      console.info(`[handleDBAReview - Dismissing reviews]: concluded dismissing review number [${review.review_id}]`)
    }

    console.log("[handleDBAReview - Pull Request approved by DBA team, returning]")
    return
  }
}

export async function handleBadDatabaseVerbs(
  octokit: App["octokit"],
  payload: any,
  appName: string,
  badVerbs: string[],
  dbaTeamName: string
) {
  const commit_id = payload.pull_request.head.sha;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const pull_number = payload.number;
  const ref = payload.pull_request.head.ref;
  
  console.info(`[handleBadDatabaseVerbs - Getting PR informations]: getPullRequestReviews and getChangedFilesContentForPullRequest`)
  
  const botPullRequestReviews = await GithubFunction.getPullRequestReviews(octokit, {owner, repo, pull_number})
    .then((res: any) => res.data
      .filter((review: any) => review.user.login === `${appName}[bot]`)
      .map((data: any) => { return {review_id: data.id, file_path: data.body, state: data.state} })
    )
  
  const pullRequestChagedFilesContentArray = await GithubFunction.getChangedFilesContentForPullRequest(octokit, {owner, repo, pull_number, ref});
  
  console.info(
    `[handleBadDatabaseVerbs - After PR informations]: getPullRequestReviews
    ${JSON.stringify(botPullRequestReviews)}`)
  
  console.info(
    `[handleBadDatabaseVerbs - After PR informations]: getChangedFilesContentForPullRequest
    ${JSON.stringify(pullRequestChagedFilesContentArray)}`)

  // looping through open reviews to dissmiss it if the file has been corrected but there is still a review opened for it
  for (const review of botPullRequestReviews){
    if (review.state === 'DISMISSED'){
      continue
    }

    const lingeringReviewArray = pullRequestChagedFilesContentArray.filter((file: any) => file.name === review.file_path && review.state === 'CHANGES_REQUESTED')
        
    if (lingeringReviewArray.length === 0){
      console.info(`[handleBadDatabaseVerbs - Inside loop for review ${review.review_id} of file ${review.file_path}]: since this file has a open review, beggining to dismiss it`)
      await GithubFunction.dismissReviewForPullRequest(octokit, {owner, repo, pull_number, review_id: review.review_id, file_path: review.file_path, message: `Review ${review.review_id} dismissed for file ${review.file_path} because no more query verbs are present`});
      console.info(`[handleBadDatabaseVerbs - Inside loop for review ${review.review_id} of file ${review.file_path}]: concluded dismissing review`)
    }
  }

  // looping through files that have any diff compared to the main branch
  for (const file of pullRequestChagedFilesContentArray){
    const openReviewsForFile = botPullRequestReviews.filter((review: any) => review.file_path === file.name && review.state === 'CHANGES_REQUESTED');
    
    console.info(`[handleBadDatabaseVerbs - Inside loop for file ${file.name}]: Open reviews: ${JSON.stringify(openReviewsForFile)}`)

    // Checking with there is any naughty verb in PR changed files:
    if (badVerbs.some((verb: any) => file.content.includes(verb)))
    {
      // Requesting DBA Team reviwer
      console.info(`[handleBadDatabaseVerbs - Requesting DBA Team Reviwers]`)
      await GithubFunction.requestTeamReviewers(octokit, {owner, repo, pull_number, team_reviewers: [dbaTeamName]})
      console.info(`[handleBadDatabaseVerbs - Reviwers requestes]`)

      // Checking if we already have a review in PR linked to the file name (also, if said review is marked as 'DISMISSED', return check):
      if (openReviewsForFile.length > 0){
        console.info(`[handleBadDatabaseVerbs - Inside loop for file ${file.name}]: Ignoring and returning from function because file [${file.name}] review is already set`)
        continue;
      } 

      // If there is no review AND the file has some BAD VERBS, create a review:
      console.info(`[handleBadDatabaseVerbs - Inside loop for file ${file.name}]: Creating a review for file [${file.name}] due to forbidden verbs: [${badVerbs}]`)
      await GithubFunction.postReviewCommentInPullRequest(octokit, {owner, repo, pull_number, commit_id, path: file.name});
      console.info(`[handleBadDatabaseVerbs - Inside loop for file ${file.name}]: Review created for file [${file.name}]`)
    } 
    else 
    {
      console.info(`[handleBadDatabaseVerbs - Inside loop for file ${file.name}]: this file DOES NOT have bad verbs`)
      
      if (openReviewsForFile.length === 0){
        console.info(`[Inside loop for file ${file.name}]: Ignoring and returning from function because file [${file.name}] has no bad verbs and no pending review`)
        continue;
      } 

      for (const review of openReviewsForFile){
        console.info(`[handleBadDatabaseVerbs - Inside loop for file ${file.name}]: since this file has a open review AND no bad verbs, beggining to dismiss of review number [${review.review_id}]`)
        await GithubFunction.dismissReviewForPullRequest(octokit, {owner, repo, pull_number, review_id: review.review_id, message: `Review ${review.review_id} dismissed for file ${review.file_path} because no more query verbs are present`});
        console.info(`[handleBadDatabaseVerbs - Inside loop for file ${file.name}]: concluded dismissing review number [${review.review_id}]`)
      }
    }
  }

  console.log("[handleBadDatabaseVerbs - End of PR bad verbs handler]")
}
