import config from "./config.json";
import mongodb = require('mongodb');
import CheapRuler from "cheap-ruler";
import * as turf from '@turf/turf'
const { MongoClient } = mongodb;

const { uniqueField, collections, baseCollection, outputFile, mongoCred } = config;

interface proximityEntry {
    [key: string]: string | number,
}

let proximityEntries: proximityEntry[] = []

MongoClient.connect(`mongodb://localhost:${mongoCred.port}`, async function (err, client) {
    if (err || !client) {
        throw `Error connecting to mongodb`
    };
    const db = client.db(mongoCred.name);
    
    //first, we get all of the unique properties for the entries in the db which we will use to quickly query whilst looping
    const uniqueFields = await allUniqueFields(db);

    //now, loop over each one
    for(const uniqueFieldValue of uniqueFields) {
        //get the matching entry for this field value
        const entry = await db.collection(baseCollection).findOne({ [uniqueField]: uniqueFieldValue }) as GeoJSON.Feature | undefined;
        if(!entry) {
            continue;
        }

        const entryProximityResult: proximityEntry = {};
        entryProximityResult[uniqueField] = uniqueFieldValue;

        for(const [collection, label] of Object.entries(collections)) {
            const nearest = await findNearest(entry.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon, collection, db)
            
        }
    }

    client.close();
});

const allUniqueFields = async (db: mongodb.Db): Promise<string[]> => {
    let uniqueFields: string[] = [];
    const list = await db.collection(baseCollection).aggregate([{
        $project: {
            [uniqueField]: 1
        }
    }]);
    await list.forEach(document => { 
        uniqueFields.push(document[uniqueField])
    });
    return uniqueFields;
}

type nearestResult = -1 | number
//returns -1 if the nearest is WITHIN the geometry, or the geometry of the nearest object if it is not
const findNearest = async (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, collection: string, db: mongodb.Db): Promise<nearestResult> => {
    const withinGeometryQueryResult = await db.collection(collection).findOne({
        geometry: { 
            $geoIntersects: { 
                $geometry: geometry
            } 
        }
    }) as GeoJSON.Feature;
    if(withinGeometryQueryResult){
        return -1;
    }

    const centroid = turf.centroid(geometry) as GeoJSON.Feature
    const point = centroid.geometry as GeoJSON.Point;
    console.log(point.coordinates[1])
    const ruler = new CheapRuler(point.coordinates[1], 'miles');
    
    for(let miles = 10; miles < 10000; miles += 10) {
        console.log(`Trying ${miles} for ${collection} and ${point.coordinates}`)
        const withinRadiusQueryResult = await db.collection(collection).find( { geometry: { $geoWithin: { $centerSphere: [ point.coordinates , miles / 3963.2 ] } } } );
        const results = await withinRadiusQueryResult.toArray() as GeoJSON.Feature[];
        if(!results.length) {
            continue;
        }
        
        return results.reduce((nearest, current) => {
            const geom = current.geometry as GeoJSON.Point;
            const distance = ruler.distance([point.coordinates[0],point.coordinates[1]], [geom.coordinates[0], geom.coordinates[1]])
            return Math.min(nearest, distance);
        }, 999999999) as number;
    }
    
    return -1;
}


