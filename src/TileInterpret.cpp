/* 
 * File:   TileInterpret.cpp
 * Author: Exiiile
 * 
 * Created on June 20, 2012, 2:27 PM
 */

#include <libtcod/libtcod.hpp>
#include "Actor.h"
#include "Effects.h"
#include "Terrain.h"
#include "Item.h"
#include "Gameplay.h"
#include "TileInterpret.h"
#include "MapManager.h"
#include "Drawable.h"
#include <iostream>
#include <fstream>
#include <string.h>
using namespace std;

TileInterpret::TileInterpret() {
    ifstream myReadFile;
    string input;
    myReadFile.open("tileinterpret.txt");
    while (myReadFile.good()){
       string foo;
       std::getline(myReadFile, foo, '\n');
       std::getline(myReadFile, foo, '\n');
       string type = foo;
       std::getline(myReadFile, foo, '\n');
       string key = foo;
       
       std::getline(myReadFile, foo, '\n');
       int i = atoi(std::string(foo).c_str());
       std::getline(myReadFile, foo, '\n' );//colors
       std::getline(myReadFile,foo, '\n');
       std::getline(myReadFile, foo, '\n');
       bool trans = (foo == "1");
       std::getline(myReadFile, foo, '\n');    
       bool walk = (foo == "1");
       std::getline(myReadFile, foo, '\n');
       TCODColor myColor(24,64,255);//temp
       TCODColor myColor2(24,64,0);//temp
       if (type.compare(0,4,"terr")== 0){    
           Terrain* a = new Terrain(i, myColor, myColor2, trans, walk);
          // terrVect.push_back(a);
           interpTerrMap[key] = a;//possible that this is not iterating
          //terrVect will eventually become tileVect, and tileinterpret will contain information 
       //for all tiles. There will have to be a series of checks at the beginning to determine
       //what type of Drawable the object is, so as to parse the correct data blocks (is destructible,
       //hp, regen, pp, moves, shiny, glowing, does damage, does type damage, is friendable, personality etc.
       }
       if (type.compare(0,4,"item")== 0){
           Item* a = new Item(i, myColor, myColor2, trans, walk);
           interpItemMap[key] = a;//possible that this is not iterating
       }
       
       if (type.compare(0,4,"acto")== 0){
           Actor* a = new Actor(i, myColor, myColor2, trans, walk);
           interpActoMap[key] = a;//possible that this is not iterating
       }
        if (type.compare(0,4,"effe")== 0){
           Effects* a = new Effects(i, myColor, myColor2, trans, walk);
           interpEffeMap[key] = a;//possible that this is not iterating
       }
       

    }
    myReadFile.close();
}

Terrain* TileInterpret::returnTerrVal(string foo){
      if (interpTerrMap[foo]==NULL)
          return NULL;
     return interpTerrMap[foo];//copy 
}

Item* TileInterpret::returnItemVal(string foo){
      if (interpItemMap[foo]==NULL)
          return NULL; 
    return interpItemMap[foo];//copy
}

Effects* TileInterpret::returnEffeVal(string foo){
      if (interpEffeMap[foo]==NULL)
          return NULL; 
    return interpEffeMap[foo];//copy
}

Actor* TileInterpret::returnActoVal(string foo){
      if (interpActoMap[foo]==NULL)
          return NULL; 
    return interpActoMap[foo];//copy
}

TileInterpret::~TileInterpret() {
}
