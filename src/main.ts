import express from 'express';
import { engine } from 'express-handlebars';
import path from 'path';

const app = express();

app.engine("hbs", engine({
    extname: ".hbs"
}));
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "../views"));

app.get('/', (req, res) => {
    res.render('match.hbs')
});

app.listen(3000, () => "Listening on port 3000!");