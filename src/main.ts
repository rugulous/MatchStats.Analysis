import express from 'express';
import { engine } from 'express-handlebars';
import path from 'path';
import 'dotenv/config';
import { getStatTypes, listMatches, loadMatch, saveMatch } from './db';
import { Data, Segment, StatType } from './types';

import handlebarsHelpers from './handlebars-helpers';
import { categoriseEvents } from './utils';

function buildOverallSegment(segments: Segment[]): Segment{
    const home = segments.flatMap(segment => segment.events.home);
    const away = segments.flatMap(segment => segment.events.away);

    return {
        name: "Overall",
        startTime: 0,
        events: {home, away},
        duration: 45,
        code: ""
    };
}

const app = express();

app.engine("hbs", engine({
    extname: ".hbs",
    helpers: handlebarsHelpers
}));

app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));

app.use(express.json());

const getData = async (id: string) => {
    const data: Data | null = await loadMatch(id);
    if(!data){
        return null;
    }

    const title = `${data.homeTeam} ${data.homeScore}-${data.awayScore} ${data.awayTeam}`;
    return {data, title};
}

app.get("/", async (_, res) => {
    res.render('list-matches.hbs', {
        title: "All Matches",
        matches: await listMatches()
    });
});

app.get("/stat-sync", async (_, res) => {
    res.json(await getStatTypes());
});

app.get('/:id/timeline', async (req, res) => {
    const data = await getData(req.params.id);
    if(!data){
        res.status(404).send();
        return;
    }

    res.render('timeline.hbs', data)
});
app.get('/:id/stats', async (req, res) => {
    const data = await getData(req.params.id);
    if(!data){
        res.status(404).send();
        return;
    }

    //add a dummy "Overall" segment
    data.data.segments.unshift(buildOverallSegment(data.data.segments));

    res.render('stats.hbs', data)
});
app.get('/:id/graphs', async (req, res) => {
    const _data = await getData(req.params.id);
    if(!_data){
        res.status(404).send();
        return;
    }

    const {data, title} = _data;

    const stats: {
        goals: {home: number, away: number}[][]
        momentum: number[][],
        home: Record<StatType, number>[][],
        away: Record<StatType, number>[][],
        segments: {name: string, code: string}[],
        maxMomentum: number,
        maxStats: number
    } = {
        goals: [],
        momentum: [],
        home: [],
        away: [],
        segments: [],
        maxMomentum: 0,
        maxStats: 0
    };

    data.segments.forEach(segment => {
        const numSegments = Math.floor(segment.duration / 5);
        const momentum: number[] = Array(numSegments).fill(0);
        //if we just fill these with [], JS makes it a reference to the same object (i.e. [].push pushes to ALL)
        const home: Record<StatType, number>[] = Array(numSegments).fill(0).map(_ => ({Shot: 0, Cross: 0, Corner: 0}));
        const away: Record<StatType, number>[] = Array(numSegments).fill(0).map(_ => ({Shot: 0, Cross: 0, Corner: 0}));
        const goals = Array(numSegments).fill(0).map(_ => ({home: 0, away: 0}));

        segment.events.home.forEach(e => {
            let section = Math.floor((((e.time - segment.startTime) / 1000) / 60) / 5);
            if(section >= numSegments){
                section = numSegments - 1; //added time
            }

            if(e.outcome == "Goal"){
                goals[section].home++;
            }
            
            if(e.statType == "Cross"){
                momentum[section]++;
            } else if(e.statType == "Shot"){
                momentum[section] += 2;
            } else {
                //corners don't add to the score
            }

            home[section][e.statType]++;
        });

        segment.events.away.forEach(e => {
            let section = Math.floor((((e.time - segment.startTime) / 1000) / 60) / 5);
            if(section >= numSegments){
                section = numSegments - 1; //added time
            }

            if(e.outcome == "Goal"){
                goals[section].away++;
            }

            if(e.statType == "Cross"){
                momentum[section]--;
            } else if(e.statType == "Shot"){
                momentum[section] -= 2;
            } else {
                //corners don't add to the score
            }

            away[section][e.statType]++;
        });

        stats.momentum.push(momentum);
        stats.home.push(home);
        stats.away.push(away);
        stats.segments.push({name: segment.name, code: segment.code});
        stats.goals.push(goals);

        for(let i = 0; i < numSegments; i++){
            if(Math.abs(momentum[i]) > stats.maxMomentum){
                stats.maxMomentum = Math.abs(momentum[i]);
            }

            if(home[i].Shot + home[i].Cross + home[i].Corner > stats.maxStats){
                stats.maxStats = home[i].Shot + home[i].Cross + home[i].Corner;
            }

            if(away[i].Shot + away[i].Cross + away[i].Corner > stats.maxStats){
                stats.maxStats = away[i].Shot + away[i].Cross + away[i].Corner;
            }
        }
    });

    const overall = buildOverallSegment(data.segments);
    const categories = categoriseEvents(overall.events);

    //for this specific situation, we want to class goals and shots on target as different events (whereas previously they've been a percentage of each other)
    const target = categories.Shot.substats['On Target'];
    const goals = categories.Shot.substats.Goals;

    target.home -= goals.home;
    target.away -= goals.away;

    let homeColours = "42, 40, 94";
    let awayColours = "209, 118, 143";

    if(data.awayTeam.toLocaleLowerCase().includes("totty")){
        //swap values
        [homeColours, awayColours] = [awayColours, homeColours];
    }

    res.render('graphs.hbs', {title, homeTeam: data.homeTeam, awayTeam: data.awayTeam, categories, colours: {home: homeColours, away: awayColours}, ...stats});
});
app.get('/:id/',  (req, res) => res.redirect(`/${req.params.id}/stats`));

app.post("/record-match", async (req, res) => {
    const id = await saveMatch(req.body);
    res.send(id);
});

app.listen(parseInt(process.env.PORT ?? "3000"), () => "Listening on port 3000!");