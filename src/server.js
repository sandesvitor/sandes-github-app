const express = require("express");
const express = require("express");
const { getRepoEnvironments } = require("./github.js")
const { Octokit } = require("octokit");
require('dotenv').config();

const app = express();

app.get("/environments", async (req, res) => {
    try {
        // OUTRA MUDANÇA
        // DELETE s
        const repository = process.env.REPOSITORY;
        const owner = process.env.OWNER;
        const token = process.env.GITHUB_TOKEN;
        const octokit = new Octokit({ auth: token });
        const environments = await getRepoEnvironments(repository, owner, octokit)
        console.log(environments)

        res.json(environments);
    } catch (e) {
        console.log(e)
    }
})

app.listen(5050, () => {
    console.log("Server running on port 5050");
})
