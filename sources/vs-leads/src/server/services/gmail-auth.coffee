GoogleStrategy = require 'passport-google-oauth'
.OAuth2Strategy

module.exports = (ndx) ->
  options = 
    clientID: process.env.GAPI_ID
    clientSecret: process.env.GAPI_SECRET
    callbackURL: process.env.GAPI_CB_URL
  #console.log 'OPTIONS', options
  ndx.passport.use new GoogleStrategy options, (accessToken, refreshToken, profile, done) ->
    user =
      profile: profile
      accessToken: accessToken
      refreshToken: refreshToken
    console.log 'user', user
    done null, user
  scope =
    scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/googletalk email'
    accessType: 'offline'
  authed = (res, req) ->
    console.log 'authed', req.user
  #console.log ndx.passport.authenticate('google', scope)
  ndx.app.get '/api/google', ndx.passport.authenticate('google', scope)
  ndx.app.get '/api/google/callback', ndx.passport.authenticate('google', {failureRedirect:'/'}), authed