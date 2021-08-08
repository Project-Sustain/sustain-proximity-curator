import config from "./config.json";
import mongodb = require('mongodb');
const { MongoClient } = mongodb;

const { joinField, collections, baseCollection, outputFile, mongoCred } = config;

MongoClient.connect(`mongodb://localhost:${mongoCred.port}`, async function (err, client) {
    if (err || !client) {
        throw `Error connecting to mongodb`
    };
    const db = client.db(mongoCred.name);
    
    //first, we get all of the unique properties for the entries in the db which we will use to quickly query whilst looping

});

const allJoinFields = (db: mongodb.Db): string[] => {
    let joins: string[] = [];
    return joins;
}

