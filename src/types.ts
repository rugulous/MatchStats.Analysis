export type StatType = "Shot" | "Cross" | "Corner";

export type Event = {
    id: number;
    statTypeID: number;
    statType: StatType;
    time: number;
    outcomeId: number;
    outcome: string;
}

export type Segment = {
    name: string;
    code: string;
    startTime: number;
    duration: 45 | 15;
    events: {
        home: Event[];
        away: Event[];
    }
}

export type Data = {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    segments: Segment[];
};