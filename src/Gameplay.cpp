/*
 * File:   Gameplay.cpp
 * Author: Brian
 *
 * Created on June 17, 2012, 1:45 AM
 */

#include "Gameplay.h"
#include <string>
#include <iostream>
#include <libtcod/libtcod.hpp>


Gameplay::Gameplay(Pokemon* a) {
    mapPosx = 2;
    mapPosy = 1;
    player = a;
    RNG = new TCODRandom();
    makeMap(3); //random int, not 3
}

int Gameplay::playgame(){
        console();  //starting a new game
        int turn = playerTurn();
        if(turn == 0){
            //save game
            return 0;
        }
        if (turn == 3){
            attackMode();//move in slot 1, slot 2, 3-6 "QWERDF"

        }
     //   if(playerTurn() == 2){
            //inventory
      //  }
        clear();
        //if play-> playerturn returns something else (when no keys are pressed, just continue to terrmap draw)
        compTurn();



}

void Gameplay::makeMap(int numberLayers){
    mapLayers.reserve(numberLayers);
    for(int p = 0; p<numberLayers;p++){
        MapGenerator gen = MapGenerator(numberLayers, p, RNG);
        MapManager* map = new MapManager(new TCODConsole(78,45));
        mapLayers[p] =  map;
        map->createTerrArray();//create all arrays
        map->makeNew();


    }
    for(int p = 0; p<numberLayers;p++){
        if (p != 0)
            mapLayers[p]->setFloorBelow(mapLayers[p--]);
        if (p != numberLayers)
            mapLayers[p]->setFloorAbove(mapLayers[p++]);
    }
    cycleMapLayer(0);
}

void Gameplay::cycleMapLayer(int newLayer){
    currentLayer = newLayer;
    Map = mapLayers[newLayer];


}

int Gameplay::playerTurn(){
    int temp = currentLayer;

    player->draw(Map->returnConsoleMap());
        for(int x = 0; x<= temp;x++){
            cycleMapLayer(x);
            if (player->returnx()>= mapw/2 && player->returny()>=maph/2){
                TCODConsole::blit(Map->returnConsoleMap(),mapw/2,maph/2,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy);
            }

            else if ( player->returny()>=maph/2){
                TCODConsole::blit(Map->returnConsoleMap(),0,maph/2,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy,1.0,1.0);
            }
            else if ( player->returnx()>=mapw/2){
                TCODConsole::blit(Map->returnConsoleMap(),mapw/2,0,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy,1.0,1.0);
            }
            else{
                TCODConsole::blit(Map->returnConsoleMap(),0,0,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy,1.0,1.0);
            }


        }

    return tryMove(Map);
}

void Gameplay::compTurn(){
    // if((Map->returnTerrain(player->returnx(), player->returny())->returnkey()).compare(0,5,"airr")==0)
      // cycleMapLayer(currentLayer-1);


    //check if player is standing on something or whatever
    //calculate ai();
        //this iterates through every actor on the map and lets the figure out what they want to do.
    //calculate speed();
        //each action will add to a priority int field.
        //it takes 5 seconds to move one square, so moving one is 5...
        //attacking takes 7-20 (20 being moves like solar beam), etc
        //sort all actors by priority....9
        //then put them into a queue.
        //pop each actor from a queue.1
        //then let them use
        //enemies attack


    //
    Map->terrToDraw(true, Map->FOV(player->returnx(),player->returny()) );
    //if player is standing on floor + ,compute fov below,
        //fov below first calls FOV on the current floor with a layer multiplier (1.5, round down?)
        //iterates through the FOV tiles and then finds those that have key string "airr"
        //then it saves those coordinates, then those coordinates are taken from the bottom floor and redrawn on the current
        //layer with a dark blue tint. theoretically, this would be recursive?
}

void Gameplay::clear(){
    TCODConsole::flush();
    TCODConsole::root->clear();
    (Map->returnConsoleMap())->clear();
}

void Gameplay::console(){
    //DRAW MAP
    const char *thing = player->getName().c_str();
    TCODConsole::root->printFrame(0,63,100,12, true, TCOD_BKGND_DARKEN, NULL);
   // TCODConsole::root->printFrame(mapPosx,mapPosy, mapSizex, mapSizey, true, TCOD_BKGND_DARKEN, NULL); //mapbox test

    TCODConsole::setColorControl(TCOD_COLCTRL_1, TCODColor::red, TCODColor::black);
   // TCODConsole::root->printLeft(82,2,TCOD_BKGND_NONE,"D", TCOD_COLCTRL_1);
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
    delete Map;
    delete gamething;
    delete player;
}

void Gameplay::attackMode(){
    //take move in slot
    //apply range, somehow calculate which coordinates are good
    //moves like agility, etc are autocasted.
    //redraw those tiles in red(or green or yellow)
    //get keys - cancel, or enter - or redirection to cardinal directions
    //probably show information... how many hits to kill which enemies? how much hp...
    //press space or something to find out that information

}

int Gameplay::tryMove(MapManager * map){
      TCOD_key_t key = TCODConsole::checkForKeypress(1);
      if ( key.vk == TCODK_KP6 || key.c == 'l' || key.vk == TCODK_RIGHT) {

          if (Map->isWalkable(player->returnx()+1,player->returny()))//check flying
                player->Actor::moveRight();

          //else return a failmove
      }
      if ( key.vk == TCODK_KP4 ||  key.c == 'h' || key.vk == TCODK_LEFT) {
           if (Map->isWalkable(player->returnx()-1,player->returny()))
                player->Actor::moveLeft();
      }
      if ( key.vk == TCODK_KP2 ||  key.c == 'j' || key.vk == TCODK_DOWN) {
          if (Map->isWalkable(player->returnx(),player->returny()+1))
        player->Actor::moveDown();
      }
      if ( key.vk == TCODK_KP8 ||  key.c == 'k' || key.vk == TCODK_UP) {
          if (Map->isWalkable(player->returnx(),player->returny()-1))
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

      if ( key.c == '>' ) {
//          if(mapLayers.size() > currentLayer+1)
            cycleMapLayer(currentLayer+1);

      }
    if ( key.c == '<' ) {
//          if(mapLayers.size() > currentLayer+1)
            cycleMapLayer(currentLayer-1);

      }
      if ( key.vk == TCODK_F11 ) {
              TCODConsole::setFullscreen(!TCODConsole::isFullscreen());
      }

      if ( key.vk == TCODK_F10 ) {
              return 0; //exit
      }
      return 1;
}
