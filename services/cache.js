const mongoose = require('mongoose');
const redis = require('redis');
const util = require('util');

const keys = require('../config/keys');

const client = redis.createClient(keys.redisUrl);
client.hget = util.promisify(client.hget);
const exec = mongoose.Query.prototype.exec;

mongoose.Query.prototype.cache = function (options = {}) {
  this.useCache = true;
  this.hashKey = options.key || '';
  return this;
}

mongoose.Query.prototype.exec = async function() {
  if (!this.useCache) {
    return exec.apply(this, arguments);
  }

  const key = JSON.stringify(Object.assign(
    {},
    this.getQuery(),
    { collection: this.mongooseCollection.name },
  ));

  // Do we have any cached data in redis
  const cacheValue = await client.hget(this.hashKey, key);

  // If yes, then respond to the request right away
  if (cacheValue) {
    console.log('SERVING FROM CACHE');
    const doc = JSON.parse(cacheValue);

    return Array.isArray(doc)
      ? doc.map(d => new this.model(d))
      : new this.model(doc);
  }

  // If no, then respond to the request and update cache
  console.log('SERVING FROM MONGODB');
  const result = await exec.apply(this, arguments);

  client.hset(this.hashKey, key, JSON.stringify(result));
  client.expire(this.hashKey, 60);

  return result;
}

module.exports = {
  clearHash(hashKey) {
    client.del(hashKey);
  }
}