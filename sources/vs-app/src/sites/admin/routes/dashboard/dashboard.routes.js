angular.module('vs-admin').config(function($stateProvider) {
  return $stateProvider.state('admin_dashboard', {
    url: '/admin',
    template: '<admin-dashboard></admin-dashboard>',
    data: {
      title: 'Vitalspace Admin - Dashboard',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})