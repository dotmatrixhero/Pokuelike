/*
 * File:   MapGenerator.h
 * Author: Brian
 *
 * Created on July 23, 2012, 10:28 PM
 */

#ifndef MAPGENERATOR_H
#define	MAPGENERATOR_H
#include "TileInterpret.h"
#include <libtcod/libtcod.hpp>
#include "Actor.h"
#include "Effect.h"
#include "Terrain.h"
#include "Item.h"
#include <vector>
#include <iostream>
#include <fstream>
#include <string>
using namespace std;

class MapGenerator {
public:
    MapGenerator(int numberLayers, int layerNumber, TCODRandom *Rand);
    MapGenerator(const MapGenerator& orig);
    virtual ~MapGenerator();
private:
    TCODRandom* RNG;
    static const int mapw = 50;
    static const int maph = 40;
    string stringMap[mapw][maph];
    void write(const char* fileName);
    void genRandomTest();
    void genBSP(int numberLayers, int layerNumber);
    bool isSurrounded(int x,int y,string type);
    void fillBox(int posx, int posy, int widthx, int heighty, string type);
    void fillBSP(TCODBsp *root);

};

#endif	/* MAPGENERATOR_H */

