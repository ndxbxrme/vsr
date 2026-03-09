const crypto = require('crypto-js');
const https = require('http');
const makeToken = (userId, key, hours) => {
  let text = userId + '||' + new Date(new Date().setHours(new Date().getHours() + hours)).toString();
  return crypto.Rabbit.encrypt(text, key).toString();
}
const userIds = {
  main: '60a6bdeb81432061fcd42d0c',
  lettings: '5b16cf4f3cd3c6e825130d53',
  maintenance: '595a032d2afd41d0867651d1',
  maintenance_leads: '5da573796a89b8dd40293b70',
  agency: '58dd0c06649da193e0dbfc57',//conveyancing
  leads: '5a55d517a0b294865a802a85',
  
}
const sites = {
  main: {
    name: 'main',
    module: 'ndx',
    url: 'http://localhost:23232',
    ws: null
  },
  lettings: {
    name: 'lettings',
    module: 'vs-lettings',
    url: 'https://lettings.vitalspace.co.uk',
    ws: 'ws://lettings.vitalspace.co.uk'
  },
  maintenance: {
    name: 'maintenance',
    module: 'vs-maintenance',
    url: 'https://maintenance.vitalspace.co.uk',
    ws: 'ws://maintenance.vitalspace.co.uk'
  },
  maintenance_leads: {
    name: 'maintenance_leads',
    module: 'vs-maintenance-leads',
    url: 'https://maintenance-leads.vitalspace.co.uk',
    ws: 'ws://maintenance-leads.vitalspace.co.uk'
  },
  agency: {
    name: 'agency',
    module: 'vs-agency',
    url: 'https://conveyancing.vitalspace.co.uk',
    ws: 'ws://conveyancing.vitalspace.co.uk'
  },
  leads: {
    name: 'leads',
    module: 'vs-leads',
    url: 'https://leads.vitalspace.co.uk',
    ws: 'ws://leads.vitalspace.co.uk'
  },
};
Object.values(sites).forEach(site => {
  site.token = makeToken(userIds[site.name], "thisismysecretdontforgetit", 24);
  site.config = {headers:{Authorization:'Bearer ' + site.token}};
});
/*
const superagent = require('superagent');
superagent.post('http://localhost:4010/api/properties/search')
.set('Authorization', 'Bearer ' + token)
.accept('text/json')
.send({buddy:true})
.end((err, res) => {
  console.log(err, res.text);
});
*/
//console.log('decrypted', crypto.Rabbit.decrypt(token, "16281e0236c9dceef935379").toString(crypto.enc.Utf8));
/*
const data = JSON.stringify({
  IncludeStc: true,
  RoleStatus: 'InstructionToLet',
  RoleType: 'Letting'
});
const options = {
  hostname: 'localhost',
  port: 4010,
  path: '/api/properties/search',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    Authorization: 'Bearer ' + token
  }
};
const req = https.request(options, res => {
  res.on('data', d => process.stdout.write(d));
});
req.on('error', error => {
  console.log('error');
});
req.write(data);
req.end();
*/