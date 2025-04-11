import { createPool, QueryResult, RowDataPacket } from "mysql2/promise";
import { Data, Event, Segment } from "./types";
import { formatTimestamp } from "./utils";

const pool = createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DB
});

const run = async <T extends QueryResult>(query: string, ...params: any[]) => {
    const [data] = await pool.execute<T>(query, params);
    let insertId = null;

    if('insertId' in data){
        insertId = data.insertId
    }

    return {data, insertId}
}

const executeQuery = async (query: string, ...params: ({} | null)[]) => {
    return await run<RowDataPacket[]>(query, ...params);
}

const singleQuery = async (query: string, ...params: any[]) => {
    const result = await run<RowDataPacket[]>(query, ...params);

    if (result.data.length === 0) {
        return null;
    }

    return result.data[0];
}

type AppEvent = {
    isHome: boolean;
    typeId: number;
    timestamp: number;
    outcomeId: number;
}

type AppSegment = {
    code: string;
    startTime: number;
    events: AppEvent[];
}

type AppMatch = {
    homeTeam: string;
    awayTeam: string;
    notes: string;
    homeGoals: number;
    awayGoals: number;
    segments: AppSegment[]
}

export async function saveMatch(match: AppMatch){
    const matchId = crypto.randomUUID();
    await executeQuery("INSERT INTO Matches (ID, HomeTeam, AwayTeam, Notes, HomeGoals, AwayGoals, HasTimestamps) VALUES (?, ?, ?, ?, ?, ?, 1)", matchId, match.homeTeam, match.awayTeam, match.notes, match.homeGoals, match.awayGoals);

    for(const segment of match.segments){
        const segmentId = (await executeQuery("INSERT INTO MatchSegments (MatchId, SegmentType, StartTime) VALUES (?, ?, ?)", matchId, segment.code, segment.startTime)).insertId;

        for(const event of segment.events){
            await executeQuery("INSERT INTO MatchStats (MatchSegmentId, IsHome, StatTypeId, Timestamp, OutcomeId) VALUES (?, ?, ?, ?, ?)", segmentId, event.isHome, event.typeId, event.timestamp, event.outcomeId);
        }
    }
    return matchId;
}

export async function loadMatch(id: string): Promise<Data | null>{
    //split into a few queries for now, probably no reason to combine
    const match = await singleQuery("SELECT * FROM Matches WHERE ID = ?", id)

    if(!match){
        return null;
    }

    const segments: {[key: number]: Segment} = {};

    (await executeQuery("SELECT ms.ID, st.Name, st.Code, ms.StartTime, st.MinuteOffset, st.Duration, s.ID AS StatID, s.IsHome, s.StatTypeID, stat.Description AS StatType, s.Timestamp, s.OutcomeID, o.Name AS Outcome, ms.VideoSecondOffset, o.IsGoal FROM MatchSegments ms INNER JOIN MatchSegmentTypes st ON st.Code = ms.SegmentType INNER JOIN MatchStats s ON s.MatchSegmentId = ms.ID INNER JOIN StatTypes stat ON stat.ID = s.StatTypeID INNER JOIN Outcomes o ON o.ID = s.OutcomeID WHERE ms.MatchID = ?", id)).data.forEach(row => {
        if(!segments.hasOwnProperty(row.ID)){
            segments[row.ID] = {
                name: row.Name,
                code: row.Code,
                startTime: row.StartTime,
                minuteOffset: row.MinuteOffset,
                duration: row.Duration,
                videoOffset: row.VideoSecondOffset,
                events: {home: [], away: []}
            }
        }

        const event: Event = {
            id: row.StatID,
            statTypeID: row.StatTypeID,
            statType: row.StatType,
            time: row.Timestamp,
            outcomeId: row.OutcomeID,
            outcome: row.Outcome,
            isGoal: !!row.IsGoal
        };

        if(row.IsHome){
            segments[row.ID].events.home.push(event);
        } else {
            segments[row.ID].events.away.push(event);
        }
    });

    return {
        homeTeam: match.HomeTeam,
        awayTeam: match.AwayTeam,
        homeScore: match.HomeGoals,
        awayScore: match.AwayGoals,
        segments: Object.values(segments),
        videoLink: match.VideoLink,
        hasTimestamps: !!match.HasTimestamps
    };
}

export async function getStatTypes(){
    //we don't want to filter here for only active, because we need to tell the app if there have been any state changes
    return {
        stats: (await executeQuery("SELECT * FROM StatTypes")).data.map(row => ({
            id: row.ID,
            description: row.Description,
            isActive: !!row.IsActive,
            sortOrder: row.SortOrder
        })),
        outcomes: (await executeQuery("SELECT * FROM Outcomes")).data.map(row => ({
            id: row.ID,
            triggeringStatTypeId: row.TriggeringStatTypeID,
            name: row.Name,
            nextActionId: row.NextActionID,
            isActive: !!row.IsActive,
            sortOrder: row.SortOrder,
            isGoal: !!row.IsGoal
        }))
    };
}

export async function listMatches(forMonth?: Date){
    let query = "SELECT m.*, ms.StartTime, ms.ID AS MatchSegmentID, mst.Name AS MatchSegmentName FROM Matches m LEFT OUTER JOIN MatchSegments ms ON ms.MatchID = m.ID LEFT OUTER JOIN MatchSegmentTypes mst ON mst.Code = ms.SegmentType ";
    const params = [];

    if(forMonth){
        query += "WHERE YEAR(FROM_UNIXTIME(StartTime / 1000)) = ? AND MONTH(FROM_UNIXTIME(StartTime / 1000)) = ? ";
        params.push(forMonth.getFullYear(), forMonth.getMonth() + 1);
    }

    query += "ORDER BY StartTime DESC";

    const {data} = await executeQuery(query, ...params);
    const matches = data.reduce((acc, row) => {    
        const segmentStart = new Date(row.StartTime);

        if(!acc.hasOwnProperty(row.ID)){
            acc[row.ID] = {...row, StartTime: segmentStart, HasTimestamps: !!row.HasTimestamps, Segments: []}
        }

        acc[row.ID].Segments.push({
            ID: row.MatchSegmentID,
            Name: row.MatchSegmentName
        });
        if(segmentStart < acc[row.ID].StartTime){
            acc[row.ID].StartTime = segmentStart;
        }

        return acc;
    }, {} as {[key: string]: {StartTime: Date, HasTimestamps: boolean, Segments: {ID: number, Name: string}[]}});

    const normalisedMatches = Object.values(matches);
    normalisedMatches.forEach(match => match.Segments.reverse());

    return normalisedMatches;
}

type SegmentEvents = {
    cross: number;
    shot: number;
    shotOnTarget: number;
    goal: number;
    corner: number;
}

type TeamEvents = {
    firstHalf: SegmentEvents;
    secondHalf: SegmentEvents;
}

type MatchData = {
    homeTeam: string;
    awayTeam: string;
    date: string;
    notes?: string;
    homeEvents: TeamEvents;
    awayEvents: TeamEvents;
    videoLink?: string;
}

export async function createManualMatch(matchData: MatchData){
    const matchId = crypto.randomUUID();
    const segmentStart = new Date(matchData.date);
    await executeQuery("INSERT INTO Matches (ID, HomeTeam, AwayTeam, Notes, HomeGoals, AwayGoals, VideoLink, HasTimestamps) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", matchId, matchData.homeTeam, matchData.awayTeam, matchData.notes ?? null, matchData.homeEvents.firstHalf.goal + matchData.homeEvents.secondHalf.goal, matchData.awayEvents.firstHalf.goal + matchData.awayEvents.secondHalf.goal, matchData.videoLink ?? null);

    await createSegment(matchId, segmentStart.getTime(), matchData.homeEvents, matchData.awayEvents, 'firstHalf', '1H');
    segmentStart.setHours(segmentStart.getHours() + 1);
    await createSegment(matchId, segmentStart.getTime(), matchData.homeEvents, matchData.awayEvents, "secondHalf", "2H");
    return matchId;
}

async function createSegment(matchId: string, start: number, homeEvents: TeamEvents, awayEvents: TeamEvents, segment: keyof TeamEvents, dbKey: string){
    const {insertId} = await executeQuery("INSERT INTO MatchSegments (MatchID, SegmentType, StartTime) VALUES (?, ?, ?)", matchId, dbKey, start);
    if(!insertId){
        throw new Error("FAILURE");
    }

    await insertEvents(insertId, homeEvents, segment, true);
    await insertEvents(insertId, awayEvents, segment, false);
}

async function insertEvents(segmentId: number, events: TeamEvents, segmentType: keyof TeamEvents, isHome: boolean){
    for(let i = 0; i < events[segmentType].cross; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 1, 17)", segmentId, isHome);
    }

    for(let i = 0; i < events[segmentType].corner; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 3, 19)", segmentId, isHome);
    }

    //shots are more complex
    for(let i = 0; i < events[segmentType].goal; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 2, 9)", segmentId, isHome);
    }

    for(let i = 0; i < events[segmentType].shotOnTarget - events[segmentType].goal; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 2, 8)", segmentId, isHome);
    }

    for(let i = 0; i < events[segmentType].shot - events[segmentType].shotOnTarget; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 2, 10)", segmentId, isHome);
    }
}

export async function getTimeline(matchId: string){
    const {data} = await executeQuery("SELECT m.HasTimestamps, m.VideoLink, m.HomeTeam, m.HomeGoals, m.AwayTeam, m.AwayGoals, ms.ID AS SegmentID, mst.Name AS SegmentName, mst.MinuteOffset, s.IsHome, (s.Timestamp - ms.StartTime) / 1000 AS EventSeconds, ms.VideoSecondOffset, s.StatTypeID, st.Description AS StatTypeName, o.IsGoal, o.ID AS OutcomeID, o.Name AS OutcomeName FROM Matches m INNER JOIN MatchSegments ms ON ms.MatchID = m.ID INNER JOIN MatchStats s ON s.MatchSegmentID = ms.ID INNER JOIN MatchSegmentTypes mst ON mst.Code = ms.SegmentType INNER JOIN StatTypes st ON st.ID = s.StatTypeId INNER JOIN Outcomes o ON o.ID = s.OutcomeID WHERE m.ID = ? ORDER BY ms.StartTime, s.Timestamp", matchId);

    if(!data){
        return null;
    }

    let lastSegmentId = null;
    let index = -1;
    const segments: {
        name: string;
        videoStartTime: string;
        events: {
            isHome: boolean;
            timestamp: string;
            videoTimestamp: string;
            stat: {
                id: number;
                name: string;
                isGoal: boolean;
            },
            outcome: {
                id: number;
                name: string;
            }
        }[]
    }[] = [];

    for(const row of data){
        row.EventSeconds = parseInt(row.EventSeconds);
        if(row.SegmentID != lastSegmentId){
            segments.push({
                name: row.SegmentName,
                videoStartTime: formatTimestamp(row.VideoSecondOffset, row.MinuteOffset),
                events: []
            });
            lastSegmentId = row.SegmentID;
            index++;
        }
    
        segments[index].events.push({
            isHome: row.IsHome,
            timestamp: formatTimestamp(row.EventSeconds, row.MinuteOffset),
            videoTimestamp: formatTimestamp(row.EventSeconds + row.VideoSecondOffset - 5, row.MinuteOffset),
            stat: {
                id: row.StatTypeID,
                name: row.StatTypeName,
                isGoal: !!row.IsGoal
            },
            outcome: {
                id: row.OutcomeID,
                name: row.OutcomeName
            }
        });
    }

    return {
        homeTeam: data[0].HomeTeam,
        awayTeam: data[0].AwayTeam,
        homeGoals: data[0].HomeGoals,
        awayGoals: data[0].AwayGoals,
        videoLink: data[0].VideoLink,
        hasTimestamps: data[0].HasTimestamps,
        segments
    };
}

export async function getMatchAndShallowSegments(matchId: string){
    const {data} = await executeQuery("SELECT m.HomeTeam, m.AwayTeam, m.HomeGoals, m.AwayGoals, m.VideoLink, m.HasTimestamps, ms.ID AS SegmentID, st.Name AS SegmentName, ms.StartTime, ms.VideoSecondOffset, st.MinuteOffset, m.EventID FROM Matches m INNER JOIN MatchSegments ms ON ms.MatchID = m.ID INNER JOIN MatchSegmentTypes st ON st.Code = ms.SegmentType WHERE m.ID = ?", matchId);

    if(data.length === 0){
        return null;
    }

    return {
        homeTeam: data[0].HomeTeam,
        awayTeam: data[0].AwayTeam,
        homeGoals: data[0].HomeGoals,
        awayGoals: data[0].AwayGoals,
        videoLink: data[0].VideoLink,
        hasTimestamps: !!data[0].HasTimestamps,
        segments: data.map(row => ({
            id: row.SegmentID,
            name: row.SegmentName,
            startTime: row.StartTime,
            videoOffset: row.VideoSecondOffset,
            minuteOffset: row.MinuteOffset
        })),
        eventId: data[0].EventID
    };
}

export async function getStats({matchSegmentId, forTeam, month}: {matchSegmentId?: number, forTeam?: string, month?: Date}){
    const {query, params} = buildStatsQuery(matchSegmentId, forTeam, month);
    const {data} = await executeQuery(query, ...params);

    const result: {[key: string]: any} = {};
    
    for (const row of data) {
        const { Description, IsHome, Outcome, StatBucket, Total, IsCollapsed } = row;
        const teamKey = IsHome ? "home" : "away";

        const stat = (result[Description] ??= { total: { home: 0, away: 0 }, buckets: {} });

        if (StatBucket) {
            const bucket = (stat.buckets[StatBucket] ??= { home: 0, away: 0, substats: {} });

            if (Outcome && !IsCollapsed) {
                bucket.substats[Outcome] ??= { home: 0, away: 0 };
                bucket.substats[Outcome][teamKey] = Total;
            }

            bucket[teamKey] += Total;
        }

        stat.total[teamKey] += Total;
    }

    return result;
}

function buildStatsQuery(matchSegmentId?: number, forTeam?: string, month?: Date){
    const params = [];
    let query = "SELECT mst.Description, ";

    if(forTeam){
        query += "CASE WHEN (m.HomeTeam LIKE CONCAT('%', ?, '%') AND IsHome = 1) OR (m.AwayTeam LIKE CONCAT('%', ?, '%') AND IsHome = 0) THEN 1 ELSE 0 END AS IsHome, ";
        params.push(forTeam, forTeam);
    } else {
        query += "ms.IsHome, ";
    }

    query += "o.Name AS Outcome, sb.Name AS StatBucket, sb.IsCollapsed, COUNT(o.Name) AS Total FROM StatTypes mst LEFT OUTER JOIN MatchStats ms ON ms.StatTypeID = mst.ID ";

    if(matchSegmentId){
        query += "AND ms.MatchSegmentID = ? ";
        params.push(matchSegmentId);
    }

    query += "LEFT OUTER JOIN MatchSegments s ON ms.MatchSegmentID = s.ID ";

    if(forTeam){
        query += "LEFT OUTER JOIN Matches m ON m.ID = s.MatchID ";
    }

    query += "LEFT OUTER JOIN Outcomes o ON o.ID = ms.OutcomeID LEFT OUTER JOIN StatBuckets sb ON sb.ID = o.StatBucketID ";

    if(month){
        query += "WHERE YEAR(FROM_UNIXTIME(s.StartTime / 1000)) = ? AND MONTH(FROM_UNIXTIME(s.StartTime / 1000)) = ? ";
        params.push(month.getFullYear(), month.getMonth() + 1);
    }

    query += "GROUP BY mst.ID, mst.Description, ";

    if(forTeam){
        query += "CASE WHEN (m.HomeTeam LIKE CONCAT('%', ?, '%') AND IsHome = 1) OR (m.AwayTeam LIKE CONCAT('%', ?, '%') AND IsHome = 0) THEN 1 ELSE 0 END";
        params.push(forTeam, forTeam);
    } else {
        query += "ms.IsHome";
    }

    query += ", o.Name, sb.Name, sb.IsCollapsed ORDER BY mst.ID, sb.ID, o.SortOrder, o.ID";

    return {query, params};
}

export async function setVideoOffset(segmentId: number, offset: number){
    await executeQuery("UPDATE MatchSegments SET VideoSecondOffset = ? WHERE ID = ?", offset, segmentId);
}

export async function setVideoLink(matchId: string, link: string){
    await executeQuery("UPDATE Matches SET VideoLink = ? WHERE ID = ?", link, matchId);
}

export async function getActiveMonths(){
    const {data} = await executeQuery("SELECT DISTINCT MONTH(FROM_UNIXTIME(StartTime / 1000)) - 1 Month, YEAR(FROM_UNIXTIME(StartTime / 1000)) Year FROM MatchSegments ORDER BY StartTime DESC");
    return data;
}

export async function getSquad(){
    const {data} = await executeQuery("SELECT ssp.SquadSectionID, ss.Name AS SquadSectionName, ssp.PlayerID, p.FirstName, p.LastName FROM Players p INNER JOIN SquadSectionPlayers ssp ON ssp.PlayerID = p.ID INNER JOIN SquadSections ss ON ss.ID = ssp.SquadSectionID WHERE ss.IsActive = 1 AND ssp.IsActive = 1");

    return Object.values(data.reduce((acc: {[key: string]: any}, row) => {
        if(!acc.hasOwnProperty(row.SquadSectionID)){
            acc[row.SquadSectionID] = {
                id: row.SquadSectionID,
                name: row.SquadSectionName,
                players: []
            }
        }

        acc[row.SquadSectionID].players.push({
            id: row.PlayerID,
            firstName: row.FirstName,
            lastName: row.LastName
        });

        return acc;
    }, {}));
}

export async function getEvents(){
    const {data} = await executeQuery("SELECT * FROM Events");
    return data;
}

export async function getAttendanceForSquad(squad: any[]){
    const {data} = await executeQuery("SELECT p.ID, e.ID AS EventID, ea.AttendanceStatus FROM Players p CROSS JOIN Events e LEFT OUTER JOIN EventAttendance ea ON ea.PlayerID = p.ID AND ea.EventID = e.ID ORDER BY Date");
    const attendanceMap = data.reduce((acc: {[key:string]: any}, row) => {
        if(!acc.hasOwnProperty(row.ID)){
            acc[row.ID] = []
        }

        acc[row.ID].push(row.AttendanceStatus);
        return acc;
    }, {});

    return squad.map(section => ({
        ...section,
        players: section.players.map((player: any) => ({
            ...player,
            attendance: attendanceMap[player.id] ?? []
        }))
    }))
}

export async function getSquadForEvent(eventId: string){
    const {data} = await executeQuery("SELECT ssp.SquadSectionID, ss.Name AS SquadSectionName, ssp.PlayerID, p.FirstName, p.LastName, ea.AttendanceStatus FROM (SELECT ID, Date FROM Events WHERE ID = ?) e CROSS JOIN Players p INNER JOIN SquadSectionPlayers ssp ON ssp.PlayerID = p.ID INNER JOIN SquadSections ss ON ss.ID = ssp.SquadSectionID LEFT JOIN EventAttendance ea ON ea.PlayerID = p.ID AND ea.EventID = e.ID WHERE e.Date BETWEEN ssp.StartDate AND IFNULL(ssp.EndDate, NOW())", eventId);

    return Object.values(data.reduce((acc: {[key: string]: any}, row) => {
        if(!acc.hasOwnProperty(row.SquadSectionID)){
            acc[row.SquadSectionID] = {
                id: row.SquadSectionID,
                name: row.SquadSectionName,
                players: []
            }
        }

        acc[row.SquadSectionID].players.push({
            id: row.PlayerID,
            firstName: row.FirstName,
            lastName: row.LastName,
            attendance: row.AttendanceStatus
        });

        return acc;
    }, {}));
}

export async function getAttendanceStatuses(){
    const {data} = await executeQuery("SELECT * FROM AttendanceStatuses ORDER BY Name");
    return data;
}

export async function updateAttendance(eventId: string, playerId: string, attendanceStatus: string){
    await executeQuery("INSERT INTO EventAttendance (EventID, PlayerID, AttendanceStatus) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE AttendanceStatus = ?", eventId, playerId, attendanceStatus, attendanceStatus);
}