import express from 'express';
import { engine } from 'express-handlebars';
import { readFileSync } from 'fs';
import path from 'path';

const app = express();

app.engine("hbs", engine({
    extname: ".hbs",
    helpers: {
        json: (obj: any) => JSON.stringify(obj),
        eachStat: (segment: any, options: Handlebars.HelperOptions) => {
            const combined = [...segment.events.home.map((e: any) => ({
                ...e,
                isHome: true
            })), ...segment.events.away.map((e: any) => ({
                ...e,
                isHome: false
            }))].sort((a, b) => a.time - b.time);

            return combined.map(event => options.fn(event)).join("");
        },
        getTime: (eventTimestamp: number, startTime: number, minuteOffset: number) => {
            const time = (eventTimestamp - startTime) / 1000;
            const minutes = minuteOffset + Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            return minutes.toString().padStart(2, '0') + ":" + seconds.toString().padStart(2, '0');
        }
    }
}));
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));

app.get('/', (_, res) => {
    const data = JSON.parse(readFileSync(path.join(__dirname, "data.json"), "utf8"));
    const title = `${data.homeTeam} ${data.homeScore}-${data.awayScore} ${data.awayTeam}`;
    res.render('timeline.hbs', {data, title});
});

app.listen(3000, () => "Listening on port 3000!");