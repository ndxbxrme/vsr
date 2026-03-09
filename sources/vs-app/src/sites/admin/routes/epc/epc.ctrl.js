import './epc.styl'
angular.module('vs-admin')
.directive('adminEpc', function(alert, env) {
  return {
    template: require('./epc.html').default,
    scope: {},
    link: (scope) => {
      scope.page = 1;
      scope.limit = 15;
      scope.pageChange = function() {
        return $('html, body').animate({
          scrollTop: 0
        }, 200);
      };
      scope.epcs = scope.list('main:propertyadmin', {where:{
        instructionToMarket: {
          epcReceived:false
        }
      }}, (epcs) => {
        epcs.items.forEach(item => {
          if(!item.property) {
            item.property = {};
            if(item.instructionToMarket.isLetting) {
              const $property = scope.single({
                route: `${env.PROPERTY_URL}/property`
              }, item.RoleId, (res) => {
                const property = res.item;
                if(!property.Address) return;
                item.property.displayAddress = `${property.Address.Number} ${property.Address.Street}, ${property.Address.Locality}, ${property.Address.Town}, ${property.Address.Postcode}`;
                item.property.vendorName = ((property.vendor ? property.vendor.Name : null) || '');
                item.property.dateInstructed = property.DateInstructed;
                item.property.image = property.Images && property.Images.length ? property.Images[0].Url : '';
                scope.epcs.save(item);
              });
            }
            else {
              const $property = scope.single('agency:clientmanagement', {RoleId:item.RoleId}, (res) => {
                const property = res.item;
                if(!property.Address) return;
                item.property.displayAddress = `${property.Address.Number} ${property.Address.Street}, ${property.Address.Locality}, ${property.Address.Town}, ${property.Address.Postcode}`;
                item.property.vendorName = ((property.vendor ? property.vendor.Name : null) || '');
                item.property.dateInstructed = property.DateInstructed;
                item.property.image = property.Images && property.Images.length ? property.Images[0].Url : '';
                scope.epcs.save(item);
              });
            }
          }
        });
        //const itemToDelete = epcs.items.find(item => item.$property.item==='no property found');
        /*
        if(itemToDelete) {
          scope.epcs.delete(itemToDelete);
        }*/
      })
      scope.properties = scope.list('agency:clientmanagement', {
        where: {
          active:true,
          instructionToMarket:{
            epcReceived:false
          }
        }
      }, (properties) => {
        properties.items.forEach(property => {
          property.$admin = scope.single('main:propertyadmin', {RoleId:property.RoleId});
        })
      });
      scope.deleteEPC = (epc) => {
        epc.instructionToMarket.epcReceived = null;
        scope.epcs.save(epc);
        alert.log('Property EPC deleted');
      }
      scope.completedEPC = (epc) => {
        epc.instructionToMarket.epcReceived = true;
        scope.epcs.save(epc);
        alert.log('Property EPC completed');
      }
    }
  }
});