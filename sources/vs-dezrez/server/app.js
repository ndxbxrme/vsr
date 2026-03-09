require('ndx-server').config({
  database: 'db',
  tables: ['users', 'properties', 'postdata', 'role', 'offers', 'events', 'viewings', 'viewingsbasic', 'property', 'propertyowners', 'searches'],
  localStorage: './data',
}).start();