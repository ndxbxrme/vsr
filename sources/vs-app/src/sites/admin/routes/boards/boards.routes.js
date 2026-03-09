angular.module('vs-admin').config(function($stateProvider) {
  return $stateProvider.state('admin_boards', {
    url: '/admin/boards',
    template: '<admin-boards></admin-boards>',
    data: {
      title: 'Vitalspace Admin - Boards Management',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})