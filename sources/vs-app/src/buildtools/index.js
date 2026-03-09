const crypto = require('crypto-js');
require('ndx-server').config({
  database: 'db',
  tables: ['users', 'emailtemplates'],
  localStorage: './data',
  hasInvite: true,
  hasForgot: true,
  softDelete: true,
  publicUser: {
    _id: true,
    displayName: true,
    local: {
      email: true,
      sites: true
    },
    roles: true
  }
})
.use(function(ndx) {
  ndx.addPublicRoute('/api/refresh-login')
  ndx.database.on('ready', async () => {
    const user = await ndx.database.selectOne('users', {local:{email:'superadmin@admin.com'}});
    user.local.sites = {
        "main": {
            "id": "60a6bdeb81432061fcd42d0c",
            "role": "superadmin"
        },
        "leads": {
            "id": "5a55d517a0b294865a802a85",
            "role": "superadmin"
        },
        "agency": {
            "id": "5f03614940b784741f7d96af",
            "role": "superadmin"
        },
        "lettings": {
            "id": "5b16cf4f3cd3c6e825130d53",
            "role": "superadmin"
        },
        "maintenance": {
            "id": "5f01a3a3af6f09519134eee4",
            "role": "superadmin"
        },
        "maintenance_leads": {
            "id": "5da573796a89b8dd40293b70",
            "role": "superadmin"
        }
    }
    await ndx.database.upsert('users', user);
    console.log('GOT USER', user);
  });
  ndx.database.on('select', (args, cb) => {
    if(args.table==='users' && args.objs.length===1) {
      const makeToken = (userId, key, hours) => {
        let text = userId + '||' + new Date(new Date().setHours(new Date().getHours() + hours)).toString();
        return crypto.Rabbit.encrypt(text, key).toString();
      }
      const user = args.objs[0];
      if(user && user.local && user.local.sites) {
        Object.values(user.local.sites).forEach(site => {
          site.token = makeToken(site.id, "thisismysecretdontforgetit", 1);
        });
      }
      return cb(true);
    }
    else {
      cb(true);
    }
  })
})
.start();