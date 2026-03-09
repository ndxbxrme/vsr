import './users.css';
const bcrypt = require('bcrypt-nodejs');
angular.module('vs-app')
.controller('mainUsersCtrl', function($scope, $http, $timeout) {
  $scope.sites = [
    {id:'main',name:'Main'},
    {id:'agency',name:'Sales'},
    {id:'leads',name:'Leads'},
    {id:'lettings',name:'Lettings'},
    {id:'maintenance',name:'Maintenance'},
    {id:'maintenance_leads',name:'Maintenance Leads'}
  ];
  $scope.roles = ['no access', 'agency', 'maintenance', 'admin', 'superadmin'];
  $scope.usersByEmail = {};
  $scope.myusers = $scope.list('main:users');
  $scope.makeNewUser = async (email, role) => {
    const prevUser = $scope.myusers.items.find(prevUser => prevUser.email===email);
    if(prevUser) {
      //alert user already exists
      return;
    }
    const newUser = {
      email: email,
      local: {
        email: email,
        password: 'blank',
        sites: {}
      },
      code: [...[...new Date().getTime().toString(23)].reverse().join('').substr(0,6)].join('').toUpperCase(),
      roles: {}
    }
    newUser.roles[role] = {};
    const res = await $http.put($http.sites.main.url + '/api/users/', newUser, $http.sites.main.config);
    const insertedUser = res.data;
    //grab roles and tokens from all sites
    await Promise.all(Object.values($http.sites).map(site => new Promise(async resolve => {
      const siteUser = (await $http.post(site.url + '/api/users/search', {where:{local:{email:email}}}, site.config)).data.items[0];
      if(siteUser) {
        insertedUser.local.sites[site.name] = {
          id: siteUser._id,
          role: Object.keys(siteUser.roles)[0]
        };
        insertedUser.displayName = insertedUser.displayName || siteUser.displayName;
        insertedUser.telephone = insertedUser.telephone || siteUser.telephone;
      }
      resolve();
    })));
    await $http.put($http.sites.main.url + '/api/users/' + insertedUser._id, insertedUser, $http.sites.main.config);
    //send email
    await $http.post($http.sites.main.url + '/api/send-new-user-email', insertedUser, $http.sites.main.config);
    /*
    if email already exists do nothing
    get roles and ids for this email address from all sites
    make new user with password changeme
    */
  };
  $scope.updateRole = async (user, role, site) => {
    const siteUser = (await $http.post($http.sites[site.id].url + '/api/users/search', {where:{local:{email:user.local.email}}}, $http.sites[site.id].config)).data.items[0];
    if(siteUser) {
      siteUser.roles = {};
      siteUser.roles[role.role] = {};
      await $http.put($http.sites[site.id].url + '/api/users/' + siteUser._id, siteUser, $http.sites[site.id].config);
    }
    else {
      const newSiteUser = JSON.parse(JSON.stringify(user));
      delete newSiteUser._id;
      newSiteUser.local.password = bcrypt.hashSync(Math.floor(Math.random() * 9999).toString(36), bcrypt.genSaltSync(8), null);
      newSiteUser.roles = {};
      newSiteUser.roles[role.role] = {};
      await $http.put($http.sites[site.id].url + '/api/users/', newSiteUser, $http.sites[site.id].config);
    }
    $scope.myusers.save(user);
  }
})
.config(($stateProvider) => $stateProvider.state('main_users', {
  url: '/users',
  template: require('./users.html').default,
  controller: 'mainUsersCtrl',
  data: {title:'Vitalspace',auth:['superadmin']}
}));