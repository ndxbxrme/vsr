import './users.css';
const bcrypt = require('bcrypt-nodejs');
angular.module('vs-app')
  .controller('mainUsersCtrl', function ($scope, $http, $timeout, alert) {
    $scope.sites = [
      { id: 'main', name: 'Main' },
      { id: 'agency', name: 'Conveyancing' },
      { id: 'leads', name: 'Leads' },
      { id: 'lettings', name: 'Lettings' },
      { id: 'maintenance', name: 'Diary' },
      { id: 'maintenance_leads', name: 'Maintenance' }
    ];
    let firstTime = true;
    $scope.sites.forEach(site => site.users = $scope.list(site.id + ':users', null, (users) => {
      //getPendingUsers();
      //const unloaded = $scope.sites.find(site => !site.users || !site.users.items || !site.users.items.length);
      //console.log('site', site.id, site.users.items);
    }))
    $scope.roles = ['no access', 'agency', 'maintenance', 'admin', 'superadmin'];
    $scope.roleIcons = ['fa-duotone fa-ban', 'fa-duotone fa-users', 'fa-duotone fa-screwdriver-wrench', 'fa-duotone fa-user-vneck-hair', 'fa-duotone fa-user-crown'];
    $scope.roleData = {
      'superadmin': {
        icon: 'fa-duotone fa-user-shield', // Represents high authority or protection
        color: '#FFD700' // Muted gold for prestige and leadership
      },
      'admin': {
        icon: 'fa-duotone fa-user-gear', // Represents management or configuration
        color: '#6A5ACD' // Muted purple for authority
      },
      'agency': {
        icon: 'fa-duotone fa-briefcase', // Represents business or agencies
        color: '#FF8C42' // Muted orange for activity and energy
      },
      'maintenance': {
        icon: 'fa-duotone fa-tools', // Clear maintenance representation
        color: '#4682B4' // Muted blue for professionalism
      },
      'no access': {
        icon: 'fa-duotone fa-circle-minus', // Universal "No" symbol
        color: '#A9A9A9' // Muted gray for inactivity or restricted
      }
    };
    $scope.swapRole = (user, siteId) => {
      if(user.local.email==='superadmin@admin.com') return;
      if(siteId==='main' && user.local.email===$scope.auth.getUser().local.email) {
        return;
      }
      const site = $scope.sites.find(site => site.id===siteId);
      let siteUser = site.users.items.find(siteUser => siteUser.local.email===user.local.email);
      if(!siteUser) {
        siteUser = {
          _id: user._id,
          email: user.email,
          displayName: user.displayName,
          telephone: user.telephone,
          local: {
            email: user.local.email,
            password: 'nothing'
          },
          roles: {}
        }
      }
      if(!user.local.sites[siteId]) {
        user.local.sites[siteId] = {id: user._id};
      }
      user.local.sites[siteId] = user.local.sites[siteId] || {};
      let currentRole = user.local.sites[siteId].role;
      let currentRoleIndex = $scope.roles.indexOf(currentRole);
      currentRoleIndex++;
      if(currentRoleIndex >= $scope.roles.length - 0) {
        currentRoleIndex = 0;
      }
      const newRole = $scope.roles[currentRoleIndex];
      user.local.sites[siteId].role = newRole;
      siteUser.roles = {};
      siteUser.roles[newRole] = {};
      siteUser.displayName = user.displayName;
      siteUser.telephone = user.telephone;
      if(siteId==='main') {
        user.roles = siteUser.roles;
      }
      // Trigger Font Awesome to refresh icons
      $scope.$applyAsync(() => {
        window.FontAwesome.dom.i2svg();
      });
      $scope.myusers.save(user);
      if(siteId!=='main') {
        site.users.save(siteUser);
      }
    };
    $scope.getIconClass = (role, user) => {
      if(!$scope.roleData[role]) return '';
      return 'fa-light ' + $scope.roleData[role].icon;
    };
    $scope.usersByEmail = {};
    $scope.pendingUsers = [];
    const checkPermissions = async () => {
      const us = $scope.sites[0].users.items.map(u => {
        return {
          email: u.local.email, sites: Object.keys(u.local.sites).map(key => {
            const role = u.local.sites[key].role;
            const roleId = u.local.sites[key].id;
            const site = $scope.sites.find(site => site.id === key);
            return { id: site.id, role, roleId, n: site.users.items.filter(siteUser => siteUser.local.email === u.local.email) };
          })
        };
      });
      const missingSites = us.map(u => {
        return { email: u.email, sites: u.sites.map(site => { return { id: site.id, role: site.role, len: !site.n.length } }).filter(o => o.len) };
      }).filter(o => o.sites.length);
      if (missingSites.length) {
        const newUser = {
          email: missingSites[0].email,
          local: {
            email: missingSites[0].email,
            password: Math.floor(Math.random() * 999999999999999).toString(23),
            sites: {
              main: {
                role: missingSites[0].sites[0].role
              }
            }
          },
          roles: {}
        };
        newUser.roles[missingSites[0].sites[0].role] = {};
        $scope.sites.find(site => site.id === missingSites[0].sites[0].id).users.save(newUser);
        return;
      }
      /*const badIds = us.map(u => {
        return u.sites.filter(site => site.n[0]._id !== site.roleId)
      }).filter(o => o.length).filter(o => o[0].n[0].local.email !== 'superadmin@admin.com');
      if (badIds.length) {
        const badUser = $scope.sites[0].users.items.find(u => u.local.email === badIds[0][0].n[0].local.email);
        const badSiteId = badIds[0][0].id;
        const realId = badIds[0][0].n[0]._id;
        badUser.local.sites[badSiteId].id = realId;
        $scope.sites[0].users.save(badUser);
        return;
      }
      const duplicates = us.filter(u => u.sites.filter(s => s.n.length > 1).length).map(u => {
        return {
          email: u.email,
          sites: u.sites.filter(s => s.n.length > 1)
        }
      }).filter(u => u.email !== 'superadmin@admin.com');
      if(duplicates.length) {
        const badSiteId = duplicates[0].sites[0].id;
        const badSite = $scope.sites.find(site => site.id === badSiteId);
        const badUser = badSite.users.items.find(u => u.local.email === duplicates[0].email);
        badSite.users.delete(badUser);
        return;
      }
      */
      return;
      if (!firstTime) return;
      firstTime = false;
      const mainUsers = $scope.sites.find(site => site.id === 'main').users.items;
      for (let mainUser of mainUsers) {
        if (mainUser.email === "superadmin@admin.com") continue;
        for (let site of $scope.sites) {
          if (site.id === 'main') continue;
          for (let siteUser of site.users.items) {
            if (siteUser.email === mainUser.email) {
              const expectedRole = mainUser.local.sites[site.id].role;
              if (!siteUser.roles[expectedRole] || siteUser.local.sites.main.role !== expectedRole) {
                siteUser.roles = {};
                siteUser.roles[expectedRole] = {};
                siteUser.local.sites.main.role = expectedRole;
                site.users.save(siteUser);
                //await new Promise(res => setTimeout(res, 10000));
              }
            }
          }
        }
      }
    }
    const getPendingUsers = () => {
      const pendingUsers = {};
      const allUserEmails = ($scope.myusers.items || []).map(user => user.local.email);
      $scope.sites.forEach(site => {
        if (site.users && site.users.items && site.users.items.length) {
          site.users.items.forEach(user => {
            pendingUsers[user.local.email] = pendingUsers[user.local.email] || JSON.parse(JSON.stringify(user));
            const myUser = pendingUsers[user.local.email];
            myUser.sites = myUser.sites || [];
            myUser.sites.push(site);
          });
        }
      });
      $scope.pendingUsers = Object.keys(pendingUsers).map(key => pendingUsers[key]).filter(user => !allUserEmails.includes(user.local.email) && !/^cors-/.test(user.displayName)).sort((a, b) => a.displayName > b.displayName ? 1 : -1);
      $scope.pendingUsers.forEach(user => user.siteRoles = $scope.getSites(user));
    }
    /*$scope.lettingsUsers = $scope.list('lettings:users', null, (lettingsUsers) => {
      lettingsUsers.items.forEach(user => {
        if(user._id==="655786db9e9fc6007c153210" && user.roles.superadmin) {
        }
      })
    });*/
    $scope.myusers = $scope.list('main:users', null, (users) => {
      getPendingUsers();
      users.items.forEach(user => {
        user.hasSiteRoles = user.siteRoles ? true : false;
        user.siteRoles = $scope.getExistingUserSites(user);
      });
      $scope.sites.forEach(site => {
        return;
        ['agency', 'lettings'].forEach(siteId => {
          if (site.id === siteId) {
            const userEmails = $scope.myusers.items.filter(user => {
              const agencyRole = user.siteRoles.find(role => role.siteId === siteId);
              return agencyRole && agencyRole.role !== 'no access';
            }).map(user => user.local.email);
            site.users.items.forEach(user => {
              if (user.deleted) return;
              if (user.local.email === 'superadmin@admin.com') return;
              const sendEmail = user.local.email && user.local.email !== 'superadmin@admin.com' && userEmails.includes(user.local.email);
              if (sendEmail !== user.sendEmail) {
                user.sendEmail = sendEmail;
                site.users.save(user);
              }
            })
          }
        })
      });
    });
    $scope.saveUserRoles = (user) => {
      $scope.myusers.save(user);
    }
    const makeCode = () => [...[...new Date().getTime().toString(23)].reverse().join('').substr(0, 6)].join('').toUpperCase();
    $scope.makeNewUserOld = async (email, role) => {
      const prevUser = $scope.myusers.items.find(prevUser => prevUser.email === email);
      if (prevUser) {
        //alert user already exists
        return;
      }
      const newUser = {
        email: email,
        local: {
          email: email,
          password: bcrypt.hashSync('tempPassword1!', bcrypt.genSaltSync(8), null),
          sites: {}
        },
        code: [...[...new Date().getTime().toString(23)].reverse().join('').substr(0, 6)].join('').toUpperCase(),
        roles: {}
      }
      newUser.roles[role] = {};
      const res = await $http.put($http.sites.main.url + '/api/users/', newUser, $http.sites.main.config);
      const insertedUser = res.data;
      //grab roles and tokens from all sites
      await Promise.all(Object.values($http.sites).map(site => new Promise(async resolve => {
        const siteUser = (await $http.post(site.url + '/api/users/search', { where: { local: { email: email } } }, site.config)).data.items[0];
        if (siteUser) {
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
      await $http.post($http.sites.main.url + '/api/send-new-user-email', insertedUser);
      /*
      if email already exists do nothing
      get roles and ids for this email address from all sites
      make new user with password changeme
      */
    };
    $scope.makeNewUser = async (email) => {
      const prevUser = $scope.myusers.items.find(prevUser => prevUser.email === email);
      if (prevUser) {
        //alert user already exists
        return;
      }
      const newUser = {
        email: email,
        local: {
          email: email,
          password: bcrypt.hashSync('tempPassword1!', bcrypt.genSaltSync(8), null),
          sites: {}
        },
        code: [...[...new Date().getTime().toString(23)].reverse().join('').substr(0, 6)].join('').toUpperCase(),
        roles: {}
      }
      const res = await $http.put($http.sites.main.url + '/api/users/', newUser, $http.sites.main.config);
      const insertedUser = res.data;
      //send email
      await $http.post($http.sites.main.url + '/api/send-new-user-email', insertedUser, $http.sites.main.config);
      alert.log('New User Email Sent');
      /*
      if email already exists do nothing
      get roles and ids for this email address from all sites
      make new user with password changeme
      */
    };
    $scope.updateRole = async (user, role, site) => {
      return;
      const siteUser = (await $http.post($http.sites[site.name].url + '/api/users/search', { where: { local: { email: user.local.email } } }, $http.sites[site.name].config)).data.items[0];
      if (siteUser) {
        siteUser.roles = {};
        siteUser.roles[role.role] = {};
        await $http.put($http.sites[site.name].url + '/api/users/' + siteUser._id, siteUser, $http.sites[site.name].config);
      }
      else {
        const newSiteUser = JSON.parse(JSON.stringify(user));
        delete newSiteUser._id;
        newSiteUser.local.password = bcrypt.hashSync(Math.floor(Math.random() * 9999).toString(36), bcrypt.genSaltSync(8), null);
        newSiteUser.roles = {};
        newSiteUser.roles[role.role] = {};
        await $http.put($http.sites[site.name].url + '/api/users/', newSiteUser, $http.sites[site.name].config);
      }
      $scope.myusers.save(user);
    }
    $scope.resetUser = async (user) => {
      await $http.post($http.sites.main.url + '/api/forgot-password', { email: user.local.email }, $http.sites.main.config);
      alert.log('Reset Email Sent');
    }
    $scope.deleteUser = async (user) => {
      if (confirm('Deleting ' + user.local.email + ', are you sure?')) {
        $scope.sites.forEach(site => {
          site.users.items.forEach(siteUser => {
            if (siteUser.local.email === user.local.email) {
              site.users.delete(siteUser);
            }
          })
        })
        alert.log('User deleted');
        /*await Promise.all(Object.values($http.sites).map(site => new Promise(async resolve => {
          try {
            const siteUser = (await $http.post($http.sites[site.name].url + '/api/users/search', {where:{local:{email:user.local.email}}}, $http.sites[site.name].config)).data.items[0];
            if(siteUser) {
              siteUser.deleted = true;
              siteUser.roles = {};
              await $http.put($http.sites[site.name].url + '/api/users/' + siteUser._id, siteUser, $http.sites[site.name].config);
            }
          } catch(e) {
            
          }
          resolve();
        })));
        user.deleted = true;
        $scope.myusers.save(user);*/
      }
    };
    $scope.getPermissions = (user) => {
      return Object.keys(Object.keys(user.local.sites).reduce((res, key) => { const site = user.local.sites[key]; res[site.role] = res[site.role] || []; res[site.role].push(site); return res; }, {})).join(', ');
    };
    $scope.getSites = (user) => {
      const siteUsers = user.sites.map((site) => {
        const siteUser = site.users.items.find(siteUser => siteUser.local.email === user.local.email);
        const userRole = Object.keys(siteUser.roles)[0];
        return {
          id: siteUser._id,
          role: userRole,
          siteId: site.id,
          name: site.name,
          icon: $scope.roleIcons[$scope.roles.indexOf(userRole)] || $scope.roleIcons[0]
        };
      });
      return siteUsers;
    }
    $scope.getExistingUserSites = (user) => {
      return Object.keys(user.local.sites).map(siteId => {
        const siteRole = user.local.sites[siteId];
        return {
          id: siteRole.id,
          role: siteRole.role,
          siteId: siteId,
          name: $scope.sites.find(site => site.id === siteId).name,
          icon: $scope.roleIcons[$scope.roles.indexOf(siteRole.role)] || $scope.roleIcons[0]

        }
      })
    }
    $scope.inviteExistingUser = async (user) => {
      let maxRole = -1;
      const siteUsers = user.sites.reduce((res, site) => {
        const siteUser = site.users.items.find(siteUser => siteUser.local.email === user.local.email);
        const userRole = Object.keys(siteUser.roles)[0];
        res[site.id] = {
          id: siteUser._id,
          role: userRole
        };
        maxRole = Math.max(maxRole, $scope.roles.indexOf(userRole));
        return res;
      }, {});
      const newUser = {
        email: user.local.email,
        local: {
          email: user.local.email,
          password: '',
          sites: siteUsers
        },
        displayName: user.displayName,
        telephone: user.telephone,
        code: makeCode(),
        roles: {}
      }
      if (maxRole > -1) {
        newUser.roles[$scope.roles[maxRole]] = {};
      }
      $scope.myusers.save(newUser);
      //newUser.email = 'lewis_the_cat@hotmail.com';
      newUser.local.email = newUser.email;
      await $http.post($http.sites.main.url + '/api/send-new-user-email', newUser, $http.sites.main.config);
      alert.log('User invited');
    };
    $scope.addEditUserOld = async (user) => {
      user = user || {
        email: '',
        local: {
          email: '',
          password: bcrypt.hashSync('tempPassword1!', bcrypt.genSaltSync(8), null),
          sites: {}
        },
        code: makeCode(),
        roles: {}
      }
      const newUser = !user.email;
      try {
        const result = await $scope.modal({
          template: require('../modals/new-user.html').default,
          controller: 'mainNewUserCtrl',
          data: {
            user: user,
            roles: $scope.roles
          }
        });
        const mainUser = $scope.sites.find(site => site.id === 'main').users.items.find(siteUser => siteUser.local.email === user.local.email);
        await Promise.all(Object.keys(result.changes).map(async key => {
          if (/^role_/.test(key)) {
            const siteName = key.replace(/^role_/, '');
            const siteRole = result.changes[key];
            const site = $scope.sites.find(site => site.id === siteName);
            if(!site || !siteRole) return;
            const siteUsers = site.users.items.filter(siteUser => siteUser.local.email === user.local.email);
            for (let siteUser of siteUsers) {
              siteUser.roles = {};
              siteUser.roles[siteRole] = {};
              siteUser.local.sites.main = siteUser.local.sites.main || {};
              siteUser.local.sites.main = siteRole;
              site.users.saveFn = (item) => {
                console.log('saved', item);
              }
              site.users.save(siteUser);
            }
            if (!siteUsers.length) {
              const newUser = {
                email: user.local.email,
                local: {
                  email: user.local.email,
                  password: Math.floor(Math.random() * 999999999999999).toString(23),
                  sites: {
                    main: siteRole
                  }
                },
                displayName: user.displayName,
                roles: {}
              }
              newUser.roles[siteRole] = {};
              site.users.save(newUser);
            }
            mainUser.local.sites[siteName] = mainUser.local.sites[siteName] || {};
            mainUser.local.sites[siteName].role = siteRole;
            const mainSiteRole = mainUser.siteRoles.find(role => role.siteId === siteName);
            if(mainSiteRole) mainSiteRole.role = siteRole;
          }
        }))
        $scope.sites.find(site => site.id === 'main').users.save(mainUser);

        if (result.changes.email) user.email = result.changes.email;
        user.local.email = user.email;
        await Promise.all(Object.keys(result.changes).map(async key => {
          if (/^role_/.test(key)) {
            const siteName = key.replace(/^role_/, '');
            const siteRole = result.changes[key];
            let siteUser;
            if (siteName !== 'main') {
              siteUser = (await $http.post($http.sites[siteName].url + '/api/users/search', { where: { local: { email: user.local.email } } }, $http.sites[siteName].config)).data.items[0];
              if (siteUser) {
                //console.log('siteuser', siteUser);
              }
              else {
                siteUser = JSON.parse(JSON.stringify(user));
              }
              siteUser.roles = {};
              siteUser.roles[siteRole] = {};
              await $http.put($http.sites[siteName].url + '/api/users/', siteUser, $http.sites[siteName].config)
            } else {
              user.roles = {};
              user.roles[siteRole] = {};
            }
            user.local.sites[siteName] = {
              role: siteRole
            }
          }
        }));
        if (newUser) {
          await $http.put($http.sites['main'].url + '/api/users/', user, $http.sites['main'].config);
        }
        const mainSiteUser = (await $http.post($http.sites['main'].url + '/api/users/search', { where: { local: { email: user.local.email } } }, $http.sites['main'].config)).data.items[0];
        if (!newUser) {
          mainSiteUser.roles = user.roles;
          mainSiteUser.local.sites = user.local.sites;
        }
        await Promise.all(Object.keys(mainSiteUser.local.sites).map(async key => {
          return new Promise(async res => {
            const siteRole = mainSiteUser.local.sites[key];
            if (!siteRole.id) {
              const siteUser = (await $http.post($http.sites[key].url + '/api/users/search', { where: { local: { email: user.local.email } } }, $http.sites[key].config)).data.items[0];
              if (siteUser) {
                siteRole.id = siteUser._id;
              }
            }
            res();
          })
        }));
        $scope.myusers.save(mainSiteUser);
        if (newUser) {
          //mainSiteUser.email = 'lewis_the_cat@hotmail.com';
          mainSiteUser.local.email = mainSiteUser.email;
          await $http.post($http.sites.main.url + '/api/send-new-user-email', mainSiteUser, $http.sites.main.config);
          alert.log('User added');
        }
        else {
          alert.log('User updated');
        }
      } catch (e) { 
        console.log('error', e);
      }
    };
    $scope.addEditUser = async (user) => {
      user = user || {
        email: '',
        local: {
          email: '',
          password: bcrypt.hashSync('tempPassword1!', bcrypt.genSaltSync(8), null),
          sites: {}
        },
        code: makeCode(),
        roles: {}
      }
      try {
        const result = await $scope.modal({
          template: require('../modals/new-user.html').default,
          controller: 'mainNewUserCtrl',
          data: {
            user: user,
            roles: $scope.roles
          }
        });
        console.log('result', result);

        if (result.changes.email) $scope.makeNewUser(result.changes.email);
      } catch (e) { 
        console.log('error', e);
      }
    };
  })
  .controller('mainNewUserCtrl', function ($scope, data, $http, ndxModalInstance) {
    $scope.forms = {};
    $scope.user = data.user;
    $scope.allRoles = data.roles;
    $scope.roles = Object.keys($http.sites).map(siteId => {
      const site = $http.sites[siteId];
      return {
        name: site.name,
        displayName: site.displayName,
        role: (data.user.local.sites[siteId] || {}).role
      }
    }).filter(site => site.name !== 'sms');
    $scope.cancel = () => ndxModalInstance.dismiss();
    $scope.submit = () => {
      const changes = $scope.forms.userForm.$$controls.filter(control => true).reduce((res, control) => { res[control.$name] = control.$modelValue; return res }, {});
      ndxModalInstance.close({ changes, roles: $scope.roles });
    };
  })
  .config(($stateProvider) => $stateProvider.state('main_users', {
    url: '/users',
    template: require('./users.html').default,
    controller: 'mainUsersCtrl',
    data: { title: 'Vitalspace App - Users', auth: ['superadmin'] }
  }));