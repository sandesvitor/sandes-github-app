async function getRepoEnvironments(repository, owner, octokit){
    const environments = await octokit.request('GET /repos/{owner}/{repo}/environments', {
        owner: owner,
        repo: repository
    })
        .then(res => res.data.environments)

    return environments;
    // dasw

}

module.exports = {
    getRepoEnvironments
}
