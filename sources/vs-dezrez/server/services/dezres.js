(function() {
    'use strict';
    var superagent;
  
    superagent = require('superagent');
  
    const sanitize = (parsedData) => {
      const sanitizedData = JSON.stringify(parsedData, (key, value) => {
        if (typeof value === 'string') {
          return value.replace(/[\x00-\x1F\x7F]/g, '');
        }
        return value;
      });
      return JSON.parse(sanitizedData);
    }

    module.exports = function(ndx) {
      var accessToken, envUrls, get, post, refreshToken, tokenExpires, urls;
      if (process.env.REZI_ID && process.env.REZI_SECRET) {
        envUrls = {
          dev: {
            auth: 'https://dezrez-core-auth-uat.dezrez.com/Dezrez.Core.Api/oauth/token/',
            api: 'https://core-api-uat.dezrez.com/api/'
          },
          production: {
            auth: 'https://auth.dezrez.com/Dezrez.Core.Api/oauth/token/',
            api: 'https://api.dezrez.com/api/'
          },
          live: {
            auth: 'https://auth.dezrez.com/Dezrez.Core.Api/oauth/token/',
            api: 'https://api.dezrez.com/api/'
          }
        };
        urls = envUrls[process.env.NODE_ENV || 'dev'];
        accessToken = null;
        tokenExpires = 0;
        refreshToken = function(cb) {
          var authCode, grantType, scopes;
          if (tokenExpires < new Date().valueOf()) {
            authCode = Buffer.from(process.env.REZI_ID + ':' + process.env.REZI_SECRET).toString('base64');
            grantType = 'client_credentials';
            scopes = 'event_read event_write people_read people_write property_read property_write impersonate_web_user';
            return superagent.post(urls.auth).set('Authorization', 'Basic ' + authCode).set('Rezi-Api-Version', '1.0').send({
              grant_type: grantType,
              scope: scopes
            }).end(function(err, response) {
              if (!err) {
                accessToken = response.body.access_token;
                tokenExpires = new Date().valueOf() + (6000 * 1000);
              }
              return cb(err);
            });
          } else {
            return cb();
          }
        };
        get = function(route, query, params) {
          return new Promise((resolve, reject) => {
            refreshToken(function(err) {
              if (!err) {
                if (params) {
                  route = route.replace(/\{([^\}]+)\}/g, function(all, key) {
                    return params[key];
                  });
                }
                query = query || {};
                query.agencyId = process.env.AGENCY_ID || 37;
                superagent.get(urls.api + route).set('Rezi-Api-Version', '1.0').set('Content-Type', 'application/json').set('Authorization', 'Bearer ' + accessToken).query(query).send().end(function(err, response) {
                  if (err) {
                    return reject(err);
                  } else {
                    return resolve(sanitize(response.body));
                  }
                });
              } else {
                return reject(err);
              }
            });
          });
        };
        post = function(route, data, params, callback) {
          var doCallback;
          doCallback = function(err, body) {
            if (Object.prototype.toString.call(params) === '[object Function]') {
              return params(err, body);
            } else if (Object.prototype.toString.call(callback) === '[object Function]') {
              return callback(err, body);
            }
          };
          return refreshToken(function(err) {
            if (!err) {
              if (params) {
                route = route.replace(/\{([^\}]+)\}/g, function(all, key) {
                  return params[key];
                });
              }
              data = data || {};
              return superagent.post(urls.api + route).set('Rezi-Api-Version', '1.0').set('Content-Type', 'application/json').set('Authorization', 'Bearer ' + accessToken).query({
                agencyId: process.env.AGENCY_ID || 37
              }).send(data).end(function(err, response) {
                return doCallback(err, response != null ? response.body : void 0);
              });
            } else {
              return doCallback(err, []);
            }
          });
        };
        const fetchProperties = (pageNo) => {
          return new Promise(async res => {
            const apiUrl = process.env.API_URL || ndx.settings.API_URL;
            const apiKey = process.env.API_KEY || ndx.settings.API_KEY;
            superagent.post(apiUrl + "search?APIKey=" + apiKey).set('Rezi-Api-Version', '1.0').send({
              MarketingFlags: 'ApprovedForMarketingWebsite',
              MinimumPrice: 0,
              MaximumPrice: 9999999,
              MinimumBedrooms: 0,
              SortBy: 0,
              PageSize: 2000,
              IncludeStc: true,
              BranchIdList: [],
              PageNumber: pageNo
            }).end(async (err, response) => {
              if(!err && response.body.Collection) {
                res(response.body.Collection);
                /*if(response.body.CurrentCount < response.body.PageSize) {
                  const nextProperties = await fetchProperties(pageNo + 1);
                  res(response.body.Collection.push(...nextProperties));
                }
                else {
                  res(response.body.Collection);
                }*/
              }
              else {
                res([]);
              }
            });

          });
        };
        const fetchProperty = (pageNo) => {
          return new Promise(async res => {
            const apiUrl = process.env.API_URL || ndx.settings.API_URL;
            const apiKey = process.env.API_KEY || ndx.settings.API_KEY;
            superagent.post(apiUrl + "search?APIKey=" + apiKey).set('Rezi-Api-Version', '1.0').send({
              MarketingFlags: 'ApprovedForMarketingWebsite',
              MinimumPrice: 0,
              MaximumPrice: 9999999,
              MinimumBedrooms: 0,
              SortBy: 0,
              PageSize: 1,
              IncludeStc: true,
              BranchIdList: [],
              PageNumber: pageNo
            }).end(async (err, response) => {
              if(!err && response.body.Collection) {
                res(response.body.Collection);
              }
              else {
                res([]);
              }
            });

          });
        };
        return ndx.dezrez = {
          get: get,
          post: post,
          fetchProperties: fetchProperties,
          fetchProperty: fetchProperty
        };
      }
    };
  
  }).call(this);
  