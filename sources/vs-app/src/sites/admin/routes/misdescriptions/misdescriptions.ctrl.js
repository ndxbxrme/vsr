import './misdescriptions.styl'
angular.module('vs-admin')
.directive('adminMisdescriptions', function(alert) {
  return {
    template: require('./misdescriptions.html').default,
    scope: {},
    link: (scope) => {
      scope.page = 1;
      scope.limit = 15;
      scope.pageChange = function() {
        return $('html, body').animate({
          scrollTop: 0
        }, 200);
      };
      scope.properties = scope.list('agency:clientmanagement', {
        where: {
          active:true,
          instructionToMarket:{
            misdescriptionsReceived:'No'
          }
        }
      }, (properties) => {
        properties.items.forEach(property => {
          property.$admin = scope.single('main:propertyadmin', {RoleId:property.RoleId});
        })
      });
      scope.received = (property) => {
        property.instructionToMarket.misdescriptionsReceived = 'Yes';
        property.$admin.item.instructionToMarket.misdescriptionsReceived = 'Yes';
        property.$admin.save();
        scope.properties.save(property);
        alert.log('Property Misdescriptions Received');
      }
    }
  }
});