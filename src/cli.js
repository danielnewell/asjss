#!/usr/bin/env node

const readdirRecursive = require('recursive-readdir-async');
const logSymbols = require('log-symbols');
const { exec, rm } = require('shelljs');
const urlJoin = require('url-join');
const prompts = require('prompts');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { resolve } = require('path');

const urlPattern = /(?:(http|https):\/\/([\w+?\.\w+])+([a-zA-Z0-9\~\!\@\#\$\%\^\&\*\(\)_\-\=\+\\\/\?\.\:\;\'\,]*)?)/g;
const imagePattern = /(?:(?:https?:\/\/))[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,4}\b(?:[-a-zA-Z0-9@:%_\+.~#?&\/=]*(\.jpg|\.png|\.jpeg))/gim;

const d = Date.now();
const tmp = path.join(__dirname, `../tmp${d}`);
const img = path.join(__dirname, `../tmp${d}/downloaded-images`);

const questions = [
    {
        type: 'text',
        name: 'repoURL',
        message: 'What is the git repository URL?',
        validate: (str) => !!str.match(urlPattern),
    },
];

prompts(questions).then(async ({ repoURL }) => {
    if (fs.existsSync(tmp)) rm('-rf', tmp);

    fs.mkdirSync(tmp);

    log(`\n${logSymbols.warning} Cloning repository data into temp directory`);

    const cloned = await clone(tmp, repoURL);
    if (!cloned) return log(`${logSymbols.error} There was a error cloning`);

    if (!fs.existsSync(img)) fs.mkdirSync(img);

    log(`\n${logSymbols.success} Cloned! Reading data...`);

    let files = await readdirRecursive
        .list(tmp)
        .catch(() =>
            log(`${logSymbols.error} There was a error reading the files`),
        );

    if (!files) return;

    files = files
        .filter((x) => !x.isDirectory)
        .map((x) => x.fullname)
        .filter((x) => !path.normalize(x).startsWith(path.join(tmp, '.git')));

    let downloads = 0;
    let failedDownloads = 0;

    let branch = await readFilePromise(
        path.join(tmp, '.git/refs/remotes/origin/HEAD'),
    );

    if (!branch)
        return log(
            `${logSymbols.error} There was a issue reading the branch you are on`,
        );

    branch = branch.split('/').pop().trim();

    for (const file of files) {
        let data = await readFilePromise(file);
        if (!data)
            return log(
                `${logSymbols.error} There was a issue reading file ${file}`,
            );

        console.log(2, data, files);
        const matches = (data.match(imagePattern) || []).filter(
            (x) => !x.startsWith(repoURL),
        );

        for (const url of matches) {
            log(`${logSymbols.warning} Downloading image ${url}`);

            const ext = `.` + url.split(`.`).pop();
            const fileName = `${path.basename(url, ext)}-${Date.now()}${ext}`;

            const done = await downloadImage(url, path.join(img, fileName));

            if (!done) {
                log(`There was a issue downloading image ${url}`);
                failedDownloads++;
            } else {
                log(`${logSymbols.success} Downloaded image ${url}`);

                data = data.replace(
                    url,
                    urlJoin(
                        repoURL,
                        'blob',
                        branch,
                        'downloaded-images',
                        fileName,
                    ),
                );

                downloads++;
            }
        }

        if (matches.length > 0) {
            fs.writeFileSync(file, data);

            exec(`cd ${tmp} && git add .`);
            exec(`cd ${tmp} && git commit -m "chore: downloaded images"`);
        }
    }

    log(`${logSymbols.warning} Done, pushing...`);

    if (downloads || failedDownloads.length > 0) exec(`cd ${tmp} && git push`);

    log(
        `${logSymbols.success} Downloaded ${downloads}, ${failedDownloads} failed`,
    );

    rm('-rf', tmp);
});

function log(msg) {
    console.log(msg + '\n');
}

function clone(directory, url) {
    const command = ['git clone', url, directory, '--depth 1'];

    return new Promise((resolve) => {
        exec(command.join(' '), (code) => {
            if (code == 0) resolve(true);
            else resolve(false);
        });
    });
}

function readFilePromise(file, type = 'utf8') {
    return new Promise((resolve) => {
        fs.readFile(file, (error, data) => {
            if (error) return resolve(false);
            resolve(data.toString());
        });
    });
}

async function downloadImage(url, p) {
    const writer = fs.createWriteStream(p);

    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
        });

        response.data.pipe(writer);

        return new Promise((resolve) => {
            writer.on('finish', () => resolve(true));
            writer.on('error', () => resolve(false));
        });
    } catch {
        resolve(false);
    }
}
