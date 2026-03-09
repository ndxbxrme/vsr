import './kadmin.styl'
angular.module('vs-admin')
.directive('adminKadmin', function(alert) {
  return {
    template: require('./kadmin.html').default,
    scope: {},
    link: (scope) => {
      scope.propertyadmin = scope.list('main:propertyadmin', null, (propertyadmin) => {
        for(let f=0; f < propertyadmin.items.length; f++) {
          const item = propertyadmin.items[f];
          if(scope.isBad(item)) {
            //scope.propertyadmin.delete(item);
            return;
          }
          propertyadmin.items.sort((a, b) => a.RoleId > b.RoleId ? 1 : -1);
        }
      });
      scope.isBad = (admin) => Object.keys(admin).length <= 3;
      scope.padelete = (admin) => {
        scope.propertyadmin.delete(admin);
      }
    }
  }
});