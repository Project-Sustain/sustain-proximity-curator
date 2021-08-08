import config from "./config.json";
import mongodb = require('mongodb');
import CheapRuler from "cheap-ruler";
import * as turf from '@turf/turf'
import fs = require('fs')
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
    let i = 0;
    for(const uniqueFieldValue of uniqueFields) {
        i++;
        console.log(`${i / uniqueFields.length * 100}`.substr(0,4) + '%')
        //get the matching entry for this field value
        const entry = await db.collection(baseCollection).findOne({ [uniqueField]: uniqueFieldValue }) as GeoJSON.Feature | undefined;
        if(!entry) {
            continue;
        }

        const entryProximityResult: proximityEntry = {};
        entryProximityResult[uniqueField] = uniqueFieldValue;

        for(const [collection, label] of Object.entries(collections)) {
            const nearest = await findNearest(entry.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon, collection, db)
            entryProximityResult[`nearest_${label.replace(/ /gi, "_").toLowerCase()}`] = nearest;
        }

        proximityEntries.push(entryProximityResult)
        console.log(entryProximityResult)
    }

    fs.writeFileSync(outputFile, JSON.stringify(proximityEntries, null, 4))
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

type nearestResult = 0 | number
//returns 0 if the nearest is WITHIN the geometry, or the geometry of the nearest object if it is not
const findNearest = async (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, collection: string, db: mongodb.Db): Promise<nearestResult> => {
    const withinGeometryQueryResult = await db.collection(collection).findOne({
        geometry: { 
            $geoIntersects: { 
                $geometry: geometry
            } 
        }
    }) as GeoJSON.Feature;
    if(withinGeometryQueryResult){
        return 0;
    }

    const centroid = turf.centroid(geometry) as GeoJSON.Feature
    const point = centroid.geometry as GeoJSON.Point;
    const ruler = new CheapRuler(point.coordinates[1], 'miles');
    
    for(let miles = 10; miles < 10000; miles += 10) {
        //console.log(`Trying ${miles} for ${collection} and ${point.coordinates}`)
        const withinRadiusQueryResult = await db.collection(collection).find( { geometry: { $geoWithin: { $centerSphere: [ point.coordinates , miles / 3963.2 ] } } } );
        const results = await withinRadiusQueryResult.toArray() as GeoJSON.Feature[];
        if(!results.length) {
            continue;
        }
        let coords: GeoJSON.Position[];
        
        return results.reduce((nearest, current) => {
            const geom = current.geometry as GeoJSON.Geometry;
            let distance = 99999999;
            if(geom.type === 'Point') {
                distance = ruler.distance([point.coordinates[0],point.coordinates[1]], [geom.coordinates[0], geom.coordinates[1]])
            }
            else if(geom.type === 'LineString') {
                coords = geom.coordinates;
            }
            else if(geom.type === 'MultiLineString' || geom.type === 'Polygon') {
                coords = geom.coordinates.flat(1);
            }   
            else if(geom.type === 'MultiPolygon') {
                coords = geom.coordinates.flat(2)
            }
            else {
                console.log(geom)
                throw geom.type;
            }
            if(geom.type !== 'Point') {
                distance = coords.reduce((nearestWithin, currentWithin) => {
                    const d = ruler.distance([point.coordinates[0],point.coordinates[1]], [currentWithin[0], currentWithin[1]])
                    return Math.min(nearestWithin, d);
                }, distance)
            }
            return Math.min(nearest, distance);
        }, 999999999) as number;
    }
    
    return -1;
}


