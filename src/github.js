async function getRepoEnvironments(repository, owner, octokit){
    // comments
    const environments = await octokit.request('GET /repos/{owner}/{repo}/environments', {
        owner: owner,
        repo: repository
    })
        .then(res => res.data.environments)

    return environments;
}

module.exports = {
    getRepoEnvironments
}
