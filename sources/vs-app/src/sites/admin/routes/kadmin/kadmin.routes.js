angular.module('vs-admin').config(function($stateProvider) {
  return $stateProvider.state('admin_kadmin', {
    url: '/admin/kadmin',
    template: '<admin-kadmin></admin-kadmin>',
    data: {
      title: 'Vitalspace Admin - K Admin',
      auth: ['superadmin']
    }
  });
})