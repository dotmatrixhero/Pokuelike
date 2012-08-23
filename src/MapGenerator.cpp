/*
 * File:   MapGenerator.cpp
 * Author: Brian
 *
 * Created on July 23, 2012, 10:28 PM
 */

#include "MapGenerator.h"
using namespace std;

MapGenerator::MapGenerator(int numberLayers, int layerNumber, TCODRandom* Rand)
{ //input string. to read file, to open file later....

RNG = Rand;
        //


   // genRandomTest();
   genBSP(numberLayers,layerNumber);

    write("maptest2.txt");
}
void MapGenerator::genRandomTest(){
    for(int x = 0; x<mapw; x++){
        for(int y = 0; y < maph; y++){
              int g = RNG->getInt(0,20);
              if (g == 0)
                 stringMap[x][y].replace(0,4, "airr");
              if (g >= 1 && g < 8)
                  stringMap[x][y].replace(0,4, "grnd");
              if (g >= 8 && g <10)
                  stringMap[x][y].replace(0,4, "wall");
              if (g>=10 && g < 12)
                  stringMap[x][y].replace(0,4,"watr");
              if (g>= 12 && g< 16)
                  stringMap[x][y].replace(0,4,"cgrs");
              if (g>=16 && g < 18)
                  stringMap[x][y].replace(0,4,"ctgs");
              if (g>=18 && g < 21)
                  stringMap[x][y].replace(0,4,"wtsh");

        }
    }


}

void MapGenerator::genBSP(int numberLayers, int layerNumber){
    if (layerNumber == 0){
        fillBox(0,0,mapw,maph,"watr");
    }
    else{
        fillBox(0,0,mapw,maph,"watr");
    }
    TCODBsp* myBSP = new TCODBsp(0,0,mapw, maph);

        int firstSplit = RNG->getInt(19,59);
        myBSP->splitOnce(false,firstSplit);
         TCODBsp *openSpace;
         TCODBsp *closedSpace;
   //      if(firstSplit>39 ){// this is one of many possible configurations. using bsp, half open, half closed style level.

     //           openSpace = myBSP->getLeft();
       //         closedSpace = myBSP->getRight();
         //}else{
                openSpace = myBSP->getRight();
                closedSpace = myBSP->getLeft();
        //}

         closedSpace->splitRecursive(NULL,3,1,1,1.0,1.0);
         openSpace->splitRecursive(NULL, 3, 1,1,1.5,1.5);
         TCODBsp *temp = closedSpace;

        fillBSP(closedSpace);
}


void MapGenerator::fillBSP(TCODBsp* root){


         TCODBsp* temp = root;




         if (temp->isLeaf()){
            fillBox(temp->x,temp->y,temp->w,temp->h,"wall");
            fillBox(temp->x+1,temp->y+1,temp->w-1,temp->h-1,"grnd");

         }else{
            fillBSP(temp->getLeft());
            fillBSP(temp->getRight());
         }
         /*temp = root->getRight();


         if (temp->isLeaf()){
            fillBox(temp->x,temp->y,temp->w,temp->h,"ctgs");
            fillBox(temp->x+1,temp->y+1,temp->w-1,temp->h-1,"cgrs");
        }else{
        fillBSP(temp);
        }*/
}

void MapGenerator::write(const char* fileName){
    ofstream myfile;
    myfile.open(fileName);
   for(int x = 0; x<mapw; x++){
        for(int y = 0; y < maph; y++){
                myfile << "TILE-"<<x<<","<<y<< "\n";
                myfile << stringMap[x][y] <<"\n";
        }
   }
    myfile.close();
}

void MapGenerator::fillBox(int posx, int posy, int widthx, int heighty, string type){
  //  if ((posx+widthx) < mapw && (posy+heighty)< maph){
        for (int x = posx; x < widthx; x++){
            for (int y = posy; y < heighty; y++){
                stringMap[x][y].replace(0,4,type);

    //        }
        }

    }
}
MapGenerator::MapGenerator(const MapGenerator& orig) {
}

MapGenerator::~MapGenerator() {
}

