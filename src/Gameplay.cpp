/* 
 * File:   Gameplay.cpp
 * Author: Brian
 * 
 * Created on June 17, 2012, 1:45 AM
 */

#include "Gameplay.h"
#include <string>
#include <iostream>

Gameplay::Gameplay(Actor* a) {
    mapPosx = 0;
    mapPosy = 8;
    player = a;
}

int Gameplay::playerTurn(){
    player->draw();
    return tryMove();
}


void Gameplay::clear(){
    TCODConsole::flush();
    TCODConsole::root->clear();
}

void Gameplay::console(){
    //DRAW MAP
    const char *thing = player->returnName();
    TCODConsole::root->printFrame(0,63,100,12, true, TCOD_BKGND_DARKEN, NULL);
   // TCODConsole::root->printFrame(mapPosx,mapPosy, mapSizex, mapSizey, true, TCOD_BKGND_DARKEN, NULL); //mapbox test
   
    TCODConsole::setColorControl(TCOD_COLCTRL_1, TCODColor::red, TCODColor::black);
    //TCODConsole::root->printLeft(82,2,TCOD_BKGND_NONE,"D", TCOD_COLCTRL_1);
    if (thing !=NULL){
            TCODConsole::root->printFrame(66,55,30,8, true, TCOD_BKGND_DARKEN, NULL);
            //TCODConsole::root->printLeft(68,56,TCOD_BKGND_NONE, thing, TCOD_COLCTRL_1);      
    }
    if (/*player has allies*/ thing != NULL){
            TCODConsole::root->printFrame(35,55,30,8, true, TCOD_BKGND_DARKEN, NULL);
            //TCODConsole::root->printLeft(37,56,TCOD_BKGND_NONE, "Ally 1", TCOD_COLCTRL_1);
            TCODConsole::root->printFrame(4,55,30,8, true, TCOD_BKGND_DARKEN, NULL);
            //TCODConsole::root->printLeft(6,56,TCOD_BKGND_NONE, "Ally 2", TCOD_COLCTRL_1);
    }
    
    //TCODConsole::root->printLeft(1,1,TCOD_BKGND_NONE,"This is enemy 1 name LV 99", TCOD_COLCTRL_1);

    //Implement toggled sidebars: inventory, party(allies), skills, help, gods, kills, view(enemies wary?), map
    //your status: health, bounty, experience, status effects, hunger, tiredness, running/crouching/stealthed, gold
    //simplify whenever possible
    
}

Gameplay::Gameplay(const Gameplay& orig) {
}

Gameplay::~Gameplay() {
    mapPosx = 0;
    mapPosy = 8;
}


int Gameplay::tryMove(){
      TCOD_key_t key = TCODConsole::checkForKeypress(1);
      if ( key.vk == TCODK_KP6 || key.c == 'l' || key.vk == TCODK_RIGHT) {
        player->Actor::moveRight();
      }
      if ( key.vk == TCODK_KP4 ||  key.c == 'h' || key.vk == TCODK_LEFT) {
        player->Actor::moveLeft();
      }
      if ( key.vk == TCODK_KP2 ||  key.c == 'j' || key.vk == TCODK_DOWN) {
        player->Actor::moveDown();
      }
      if ( key.vk == TCODK_KP8 ||  key.c == 'k' || key.vk == TCODK_UP) {
        player->Actor::moveUp();
      }
      if ( key.vk == TCODK_KP9 ||  key.c == 'u') {
        player->Actor::moveUpRight();
      }
      if ( key.vk == TCODK_KP7 ||  key.c == 'y') {
        player->Actor::moveUpLeft();
      }
      if ( key.vk == TCODK_KP1 ||  key.c == 'b') {
        player->Actor::moveDownLeft();
      }
      if ( key.vk == TCODK_KP3 ||  key.c == 'n') {
        player->Actor::moveDownRight();
      }
      if ( key.vk == TCODK_F11 ) {
              TCODConsole::setFullscreen(!TCODConsole::isFullscreen());
      }
      
      if ( key.vk == TCODK_F10 ) {
              return 0; //exit
      }
      return 1;
}
