const superagent = require('superagent');
module.exports = (ndx) => {
  const changeList = [];
  let bootingUp = true;
  let webhookCount = 0;
  let pollCount = 0;
  let processed = {
    properties: 0,
    offers: 0,
    viewings: 0,
    events: 0,
    searches: 0,
    added: 0,
    removed: 0,
    webhookCalls: 0,
    errors: 0,
    errorMsg: '',
    propertyErrors: [],
    pollingErrors: [],
    log: ''
  }
  let startDate = new Date();
  const lastCalls = new Map();
  function throttle(fn, delay, fnName) {
    const now = Date.now();
    if (now - lastCalls.get(fnName) < delay) return;
    fn();
    lastCalls.set(fnName, now);
  }
  const updateSearch = async () => {
      const properties = await ndx.dezrez.fetchProperties(1);
      const searches = await ndx.database.selectOne('searches', {_id:1});
      await ndx.database.upsert('searches', {_id:1,properties:properties});
      if(!bootingUp) {
        superagent.post(process.env.VS_PROPERTY_WEBHOOK).end();
        processed.webhookCalls++;
      }
      if(searches && searches.properties && searches.properties.length) {
        const oldRoleIds = searches.properties.map(prop => prop.RoleId);
        const newRoleIds = properties.map(prop => prop.RoleId);
        const removedRoleIds = oldRoleIds.filter(x => newRoleIds.indexOf(x) === -1);
        const addedRoleIds = newRoleIds.filter(x => oldRoleIds.indexOf(x) === -1);
        addedRoleIds.forEach(RoleId => {
          updateProperty(null, RoleId, null, 'property');
          updateProperty(null, RoleId, null, 'offer');
          updateProperty(null, RoleId, null, 'viewing');
          //updateProperty(null, RoleId, null, 'event');
          processed.added++;
        });
        removedRoleIds.forEach(async RoleId => {
          updateProperty(null, RoleId, null, 'property');
          /*ndx.database.delete('events', { _id: RoleId });
          ndx.database.delete('viewingsbasic', { _id: RoleId });
          ndx.database.delete('offers', { _id: RoleId });
          const role = await ndx.database.selectOne('role', { _id: RoleId });
          if (role) {
              ndx.database.delete('owners', { _id: +role.PropertyId });
              ndx.database.delete('property', { _id: +role.PropertyId });
              if (role.TenantRoleId) {
                  ndx.database.delete('role', { _id: +role.TenantRoleId });
              }
              if (role.PurchasingRoleId) {
                  ndx.database.delete('role', { _id: +role.PurchasingRoleId });
              }
              if (role.agent_ref) {
                  ndx.database.delete('role', { _id: +role.agent_ref });
              }
              ndx.database.delete('role', { _id: +role._id });
          }*/
          processed.removed++;
        });
      }
      processed.searches++;
      return properties;
  }
  const getEventType = (eventName) => {
    if(['Offer', 'OfferResponse', 'LettingOffer', 'offer'].includes(eventName)) {
      return 'offer';
    }
    if(['Viewing', 'ViewingFeedback', 'viewing'].includes(eventName)) {
      return 'viewing';
    }
    if(['GenericEvent', 'EventPropertySearch', 'EventKey', 'EventAlarm', 'event'].includes(eventName)) {
      return 'event';
    }
    return 'property';
    //['Valuation', 'Appointment', 'Valued', 'Note', 'InstructionToLet', 'FeeChanged', 'VendorNotified', 'Let', 'InstructionToSell', 'GroupStatus', 'WithdrawnValuation', 'CheckOut', 'FallenThrough', 'PriceChange', 'Exchanged', 'Completed', 'Ended', 'WithdrawnInstruction']
  }
  const updateProperty = async (propertyId, propertyRoleId, eventId, eventName) => {
    try {
      if(!propertyRoleId) {
        if(eventId && eventName) {
          const res = await ndx.dezrez.get('event/' + eventId, {});
          if(res) {
            const event = res.length ? res[0] : res;
            propertyId = event.Property ? event.Property.Id : event.PropertyId;
            propertyRoleId = event.MarketingRoleId;
          }
        }
        /*if(propertyId) {
          const res = await ndx.dezrez.get('property/' + propertyId, null, "");
          propertyRoleId = res.RoleId;
        }*/
      }
      //processed.log += '\npropertyRoleId, ' + propertyRoleId;
      if(propertyRoleId) {
        const eventType = getEventType(eventName);
        if(eventType==='event') return;
        const prevChange = changeList.find(change => change.id===propertyRoleId && change.type === eventType);
        if(!prevChange) {
          changeList.push({
            id: propertyRoleId,
            type: eventType,
            eventName
          })
        }
      }
    } catch (e) {
      console.log(e);
      processed.errors++;
      processed.errorMsg = e;
      processed.propertyErrors.push({
        propertyId,
        propertyRoleId,
        eventId,
        eventName
      });
    }
  };
  const pollForChanges = async () => {
    pollCount++;
    if (bootingUp && !changeList.length) {
        bootingUp = false;
        superagent.post(process.env.VS_PROPERTY_WEBHOOK).end();
        processed.webhookCalls++;
    }
    if (changeList.length) {
        const change = changeList.shift();
        console.log(changeList.length, change);
        try {
            switch (change.type) {
                case 'property':
                    //get role
                    const role = await ndx.dezrez.get('role/{id}', null, { id: change.id });
                    role._id = +change.id;
                    ndx.database.upsert('role', role);
                    try {
                      superagent.post(process.env.VS_APP_WEBHOOK + '/' + role._id).end();
                    }
                    catch(webhookError) {
                      console.log('error posting to app', webhookError);
                    }
                    //tenantrole
                    if (role && role.TenantRoleId) {
                        const tenantrole = await ndx.dezrez.get('role/{id}', null, { id: role.TenantRoleId });
                        tenantrole._id = +role.TenantRoleId;
                        ndx.database.upsert('role', tenantrole);
                    }
                    //purchasingrole
                    if (role && role.PurchasingRoleId) {
                        const purchasingrole = await ndx.dezrez.get('role/{id}', null, { id: role.PurchasingRoleId });
                        purchasingrole._id = +role.PurchasingRoleId;
                        ndx.database.upsert('role', purchasingrole);
                    }
                    //agent_ref
                    if (role && role.agent_ref) {
                        const agent_ref = await ndx.dezrez.get('role/{id}', null, { id: role.agent_ref });
                        agent_ref._id = +role.agent_ref;
                        ndx.database.upsert('role', agent_ref);
                    }
                    //property/:id
                    if (role && role.PropertyId) {
                        const property = await ndx.dezrez.get('property/{id}', null, { id: role.PropertyId });
                        property._id = +role.PropertyId;
                        ndx.database.upsert('property', property);
                    }
                    //property/:id/owners
                    if (role && role.PropertyId) {
                        const propertyowners = {
                            _id: +role.PropertyId,
                            body: await ndx.dezrez.get('property/{id}/owners', null, { id: role.PropertyId })
                        }
                        ndx.database.upsert('propertyowners', propertyowners);
                    }
                    //inform vs-property
                    processed.properties++;
                    break;
                case 'offer':
                    const offers = {
                        _id: +change.id,
                        body: await ndx.dezrez.get('role/{id}/offers', null, { id: change.id })
                    };
                    ndx.database.upsert('offers', offers);
                    processed.offers++;
                    break;
                case 'viewing':
                    const viewings = {
                        _id: +change.id,
                        body: await ndx.dezrez.get('role/{id}/viewings', null, { id: change.id })
                    };
                    ndx.database.upsert('viewings', viewings);
                    const viewingsbasic = {
                        _id: +change.id,
                        body: await ndx.dezrez.get('role/{id}/viewingsbasic', null, { id: change.id })
                    };
                    ndx.database.upsert('viewingsbasic', viewingsbasic);
                    processed.viewings++;
                    break;
                /*case 'event':
                    const events = {
                        _id: +change.id,
                        body: await ndx.dezrez.get('role/{id}/events', { pageSize: 2000 }, { id: change.id })
                    };
                    ndx.database.upsert('events', events);
                    processed.events++;
                    break;*/
            }
            throttle(updateSearch, .5 * 60 * 1000, 'updateSearch');
        } catch (e) {
          console.error('error', e);
          processed.errors++;
          processed.errorMsg = e;
          processed.pollingErrors.push(change);
        }
    }
    setTimeout(pollForChanges, bootingUp ? 3000 : 3000);
  };
  ndx.database.on('ready', async () => {
      bootingUp = true;
      await updateSearch();
      pollForChanges();
  });
  ndx.app.post('/refresh', async (req, res, next) => {
      bootingUp = true;
      const properties = await updateSearch();
      properties.forEach((property, index) => {
        updateProperty(null, property.RoleId, null, 'property');
        updateProperty(null, property.RoleId, null, 'offer');
        updateProperty(null, property.RoleId, null, 'viewing');
        //updateProperty(null, property.RoleId, null, 'event');
      });
      res.end('ok');
  });
  ndx.app.post('/refresh/:id', async (req, res, next) => {
      if(req.params.id && +req.params.id > 0) {
        updateProperty(null, +req.params.id, null, 'property');
        updateProperty(null, +req.params.id, null, 'offer');
        updateProperty(null, +req.params.id, null, 'viewing');
        //updateProperty(null, +req.params.id, null, 'event');
        return res.end('ok');
      }
      res.end('bad id');
  })
  ndx.app.post('/refresh-searches', async (req, res, next) => {
      await updateSearch();
      res.end('ok');
  });
  ndx.app.get('/status', (req, res, next) => {
      res.json({
          bootingUp,
          changeList,
          webhookCount,
          pollCount,
          startDate,
          processed
      })
  });
  ndx.app.post('/webhook', async (req, res, next) => {
    if (req.body) {
      webhookCount++;
      //ndx.database.insert('postdata', req.body);
      const event = req.body;
      //processed.log += '\nupdateProperty, ' + event.PropertyId + ', ' + event.PropertyRoleId + ', ' + event.RootEntityId + ', ' + event.EventName;
      updateProperty(event.PropertyId, event.PropertyRoleId, event.RootEntityId, event.EventName);
      try {
        superagent.post("http://92.236.199.184:4220/event").send(req.body).end();
      } catch(e) {

      }
    }
    res.end('ok');
  });
};